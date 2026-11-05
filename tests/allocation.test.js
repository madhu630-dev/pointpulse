process.env.NODE_ENV = 'test';
const assert = require('assert');
const http = require('http');
const { PassThrough } = require('stream');
const { app } = require('../server');
const { get, all, run, ADMIN_EMAIL } = require('../db/database');
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../middleware/authMiddleware');

function api(endpoint, options = {}) {
    return new Promise((resolve, reject) => {
        try {
            const method = options.method || 'GET';
            let bodyStr = options.body;
            const headers = { host: 'localhost' };
            if (options.headers) {
                for (const [k, v] of Object.entries(options.headers)) {
                    headers[k.toLowerCase()] = v;
                }
            }
            if (bodyStr && typeof bodyStr === 'object' && !(bodyStr instanceof Buffer)) {
                bodyStr = JSON.stringify(bodyStr);
                headers['content-type'] = 'application/json';
            }
            if (bodyStr) {
                headers['content-length'] = Buffer.byteLength(bodyStr);
            }

            const req = new http.IncomingMessage(new PassThrough());
            req.method = method;
            req.url = endpoint;
            req.headers = headers;

            const res = new http.ServerResponse(req);
            let resData = '';
            res.write = function (chunk) {
                resData += chunk.toString();
                return true;
            };
            res.end = function (chunk) {
                if (chunk) resData += chunk.toString();
                let parsedBody = '';
                const headerEndIdx = resData.indexOf('\r\n\r\n');
                if (headerEndIdx !== -1) {
                    parsedBody = resData.substring(headerEndIdx + 4);
                } else {
                    parsedBody = resData;
                }
                let json = null;
                try { json = JSON.parse(parsedBody); } catch (e) {}
                resolve({
                    status: res.statusCode,
                    headers: res.getHeaders ? res.getHeaders() : {},
                    body: json !== null ? json : parsedBody
                });
            };

            res.on('error', reject);
            app.handle(req, res);

            if (bodyStr) {
                req.push(bodyStr);
            }
            req.push(null);
        } catch (e) {
            reject(e);
        }
    });
}

async function testAllocationWorkflow() {
    console.log('\n--- TESTING REDEMPTION ALLOCATIONS & ADMIN VIEWS ---');

    // 1. Get Admin & an Operator
    const adminUser = await get('SELECT * FROM app_users WHERE email = ?', [ADMIN_EMAIL]);
    const operatorUser = await get("SELECT * FROM app_users WHERE email = 'pulapallimahesh31@gmail.com' AND role = 'user'");
    
    assert(adminUser, 'Admin user must exist');
    assert(operatorUser, 'Operator Mahesh Pulapalli must exist');

    const adminToken = jwt.sign({ id: adminUser.id, email: adminUser.email, role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });
    const operatorToken = jwt.sign({ id: operatorUser.id, email: operatorUser.email, role: 'user' }, JWT_SECRET, { expiresIn: '1h' });

    // 2. Create a test account assigned to operator if none in memTables
    const createRes = await api('/api/accounts', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${adminToken}` },
        body: {
            user_id: operatorUser.id,
            email: `redeem_test_${Date.now()}@outlook.com`,
            server: 'US-TX#101',
            initial_points: 7500,
            classification: 'new'
        }
    });
    assert(createRes.status === 200 || createRes.status === 201, 'Account creation failed');
    const createdAccId = createRes.body.account.id;

    // 3. Fetch User Allocation Workspace Data
    const userWorkspaceRes = await api('/api/allocations/user', {
        headers: { 'Authorization': `Bearer ${operatorToken}` }
    });
    
    assert.strictEqual(userWorkspaceRes.status, 200);
    assert(userWorkspaceRes.body.settings, 'Settings should be present');
    assert(Array.isArray(userWorkspaceRes.body.availableAccounts), 'availableAccounts should be array');
    assert(Array.isArray(userWorkspaceRes.body.allocatedAccounts), 'allocatedAccounts should be array');
    console.log(`  ✅ [PASS] User allocation workspace loaded. Available accounts: ${userWorkspaceRes.body.availableAccounts.length}`);

    // Unlock first if previously locked
    await run('UPDATE user_redemption_allocations SET is_locked = 0 WHERE user_id = ?', [operatorUser.id]);

    // 4. Operator submits batch
    const submitRes = await api('/api/allocations/user/submit', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${operatorToken}` },
        body: { accountIds: [createdAccId] }
    });

    assert.strictEqual(submitRes.status, 200);
    assert.strictEqual(submitRes.body.success, true);
    assert.strictEqual(submitRes.body.isLocked, true);
    console.log(`  ✅ [PASS] Operator submitted allocation batch (1 account). Batch is now locked.`);

    // 5. Test that submitting again fails while locked
    const lockedRes = await api('/api/allocations/user/submit', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${operatorToken}` },
        body: { accountIds: [createdAccId] }
    });

    assert.strictEqual(lockedRes.status, 403);
    console.log(`  ✅ [PASS] Locked batch correctly rejects modifications while locked.`);

    // 6. Admin View
    const adminViewRes = await api(`/api/allocations/admin?userId=${operatorUser.id}`, {
        headers: { 'Authorization': `Bearer ${adminToken}` }
    });

    assert.strictEqual(adminViewRes.status, 200);
    assert(Array.isArray(adminViewRes.body.operators), 'Operators tabs should be present');
    assert(Array.isArray(adminViewRes.body.accounts), 'Accounts should be present');
    assert.strictEqual(adminViewRes.body.selectedUserId, operatorUser.id);

    const submittedAcc = adminViewRes.body.accounts.find(a => a.id === createdAccId);
    assert(submittedAcc, 'Submitted account must appear in Admin 11-column table');
    assert(submittedAcc.allocationId, 'allocationId must be present');
    assert(submittedAcc.redemptionStatus, 'redemptionStatus must be present');
    console.log(`  ✅ [PASS] Admin view renders 11-column table for operator with account ${submittedAcc.email} (${submittedAcc.redemptionStatus})`);

    // 7. Admin Toggle Redemption Status
    const toggleRes = await api(`/api/allocations/admin/toggle/${submittedAcc.allocationId}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${adminToken}` }
    });

    assert.strictEqual(toggleRes.status, 200);
    assert.strictEqual(toggleRes.body.success, true);
    assert.strictEqual(toggleRes.body.status, 'redeemed');
    console.log(`  ✅ [PASS] Admin 1-click toggled redemption status to "Redeemed"`);

    // 8. Admin Settings Update (Quota limit & Review gate)
    const settingsRes = await api(`/api/allocations/admin/settings/${operatorUser.id}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${adminToken}` },
        body: { maxAccounts: 15, isOpen: true, isFormRequired: false }
    });

    assert.strictEqual(settingsRes.status, 200);
    assert.strictEqual(settingsRes.body.settings.maxAccounts, 15);
    console.log(`  ✅ [PASS] Admin saved quota limit settings (15 accounts)`);

    // 9. Admin Unlock Batch
    const unlockRes = await api(`/api/allocations/admin/unlock/${operatorUser.id}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${adminToken}` }
    });

    assert.strictEqual(unlockRes.status, 200);
    assert.strictEqual(unlockRes.body.success, true);
    console.log(`  ✅ [PASS] Admin unlocked batch. Operator can drag & drop again.`);

    console.log('--- ALL ALLOCATION & REDEMPTION TESTS PASSED! ---\n');
    process.exit(0);
}

testAllocationWorkflow().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});
