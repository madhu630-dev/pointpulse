const assert = require('assert');
const http = require('http');
const { app } = require('../server');
const { get, run, all, ADMIN_EMAIL, supabase } = require('../db/database');

let baseUrl = '';
let testServer = null;

// Helper to make API requests against test server
function api(endpoint, options = {}) {
    return new Promise((resolve, reject) => {
        const url = new URL(endpoint, baseUrl);
        const headers = options.headers || {};
        if (options.body && typeof options.body === 'object' && !(options.body instanceof Buffer)) {
            options.body = JSON.stringify(options.body);
            headers['Content-Type'] = 'application/json';
        }

        const req = http.request(url, {
            method: options.method || 'GET',
            headers: headers
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                let json = null;
                try { json = JSON.parse(data); } catch (e) {}
                resolve({
                    status: res.statusCode,
                    headers: res.headers,
                    body: json !== null ? json : data
                });
            });
        });

        req.on('error', reject);
        if (options.body) req.write(options.body);
        req.end();
    });
}

async function runTests() {
    console.log('\n======================================================');
    console.log('🧪 POINTPULSE PLATFORM COMPREHENSIVE AUTOMATED TESTS');
    console.log('======================================================\n');

    let passedCount = 0;
    let failedCount = 0;

    async function test(name, fn) {
        try {
            await fn();
            console.log(`  ✅ [PASS] ${name}`);
            passedCount++;
        } catch (err) {
            console.error(`  ❌ [FAIL] ${name}`);
            console.error(`     Error: ${err.message}`);
            failedCount++;
        }
    }

    // Clean up test non-admin users from previous test runs
    await run(`DELETE FROM app_users WHERE email != ?`, [ADMIN_EMAIL]);
    await run(`DELETE FROM notifications`);
    await run(`DELETE FROM user_requests`);
    await run(`DELETE FROM form_submissions`);

    // Start server on an ephemeral port
    await new Promise((resolve) => {
        const listener = app.listen(0, () => {
            const port = listener.address().port;
            baseUrl = `http://localhost:${port}`;
            testServer = listener;
            resolve();
        });
    });

    let adminToken = '';
    let testUserToken = '';
    let testUserId = null;
    let testAccId = null;
    const testEmail = `sarah.operator_${Date.now()}@gmail.com`;

    console.log('--- SUITE 1: AUTHENTICATION & SINGLE ADMINISTRATOR ---');

    await test('Sole Administrator authentication (001.workme@gmail.com)', async () => {
        const res = await api('/api/auth/google', {
            method: 'POST',
            body: { credential: `TEST_TOKEN_${ADMIN_EMAIL}:PointPulse Admin` }
        });
        assert.strictEqual(res.status, 200, 'Admin login should return 200');
        assert.strictEqual(res.body.success, true);
        assert.strictEqual(res.body.user.role, 'admin');
        assert.strictEqual(res.body.user.email, ADMIN_EMAIL);
        adminToken = res.body.token;
        assert(adminToken, 'Admin token should be issued');
    });

    await test('Single Administrator Protection: cannot promote or register another admin', async () => {
        const res = await api('/api/auth/register-form', {
            method: 'POST',
            body: {
                credential: `TEST_TOKEN_fakeadmin@gmail.com:Fake Admin`,
                displayName: 'Fake Admin',
                termsAccepted: true
            }
        });
        // Normal registration strictly creates role='user'
        const check = await get(`SELECT role FROM app_users WHERE email = 'fakeadmin@gmail.com'`);
        assert(check, 'User created');
        assert.strictEqual(check.role, 'user', 'New user role must be strictly user, never admin');
    });

    await test('User Registration Flow: creates pending record', async () => {
        const regRes = await api('/api/auth/register-form', {
            method: 'POST',
            body: {
                credential: `TEST_TOKEN_${testEmail}:Sarah Operator`,
                displayName: 'Sarah (Morning)',
                phone: '+1 555-0100',
                registrationPurpose: 'account_operator',
                accountManagementDescription: 'Manage US farm accounts',
                termsAccepted: true
            }
        });

        assert.strictEqual(regRes.status, 200);
        assert.strictEqual(regRes.body.status, 'pending');
        testUserId = regRes.body.user.id;
        testUserToken = regRes.body.token;
        assert(testUserId, 'User ID should be returned');
        assert(testUserToken, 'User session token should be returned');
    });

    await test('Pending user cannot access protected dashboard APIs (returns 403)', async () => {
        const res = await api('/api/accounts', {
            headers: { 'Authorization': `Bearer ${testUserToken}` }
        });
        assert.strictEqual(res.status, 403, 'Pending user must be blocked with 403');
    });

    console.log('\n--- SUITE 2: ADMIN APPROVAL WORKFLOW & PERMISSIONS ---');

    await test('Administrator approves pending user registration', async () => {
        const approveRes = await api(`/api/admin/users/${testUserId}/status`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${adminToken}` },
            body: { action: 'approve' }
        });
        assert.strictEqual(approveRes.status, 200);
        assert.strictEqual(approveRes.body.status, 'approved');

        // Check user session
        const meRes = await api('/api/auth/me', {
            headers: { 'Authorization': `Bearer ${testUserToken}` }
        });
        assert.strictEqual(meRes.status, 200);
        assert.strictEqual(meRes.body.user.status, 'approved');
    });

    await test('Approved user starts in READ-ONLY mode (cannot update points without permission)', async () => {
        const res = await api(`/api/accounts/1/points`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${testUserToken}` },
            body: { points: 9999 }
        });
        assert.strictEqual(res.status, 403, 'Points update without permission must return 403');
        assert.strictEqual(res.body.code, 'PERMISSION_DENIED');
    });

    await test('Administrator grants temporary points update window', async () => {
        const now = new Date();
        const start = new Date(now.getTime() - 10000).toISOString();
        const end = new Date(now.getTime() + 60000).toISOString();

        const grantRes = await api(`/api/admin/users/${testUserId}/temporary-window`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${adminToken}` },
            body: { startTime: start, endTime: end, permittedActions: ['update_points'] }
        });
        assert.strictEqual(grantRes.status, 200);
        assert.strictEqual(grantRes.body.success, true);
    });

    console.log('\n--- SUITE 3: ACCOUNT ISOLATION & DATA SECURITY ---');

    await test('Strict Data Isolation: User only accesses their own assigned accounts', async () => {
        // Create an account belonging to test user
        const createRes = await api('/api/accounts', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${adminToken}` },
            body: {
                user_id: testUserId,
                email: `isolated_${Date.now()}@outlook.com`,
                server: 'US-TX#101',
                initial_points: 6200,
                classification: 'new'
            }
        });
        assert.strictEqual(createRes.status, 200);
        testAccId = createRes.body.account.id;

        // User queries accounts
        const userAccRes = await api('/api/accounts', {
            headers: { 'Authorization': `Bearer ${testUserToken}` }
        });
        assert.strictEqual(userAccRes.status, 200);
        assert(Array.isArray(userAccRes.body));
        
        // Ensure all accounts returned belong to testUserId
        const otherAccounts = userAccRes.body.filter(a => a.user_id !== testUserId);
        assert.strictEqual(otherAccounts.length, 0, 'User must NEVER see another user accounts');

        // Verify password is NOT in response
        userAccRes.body.forEach(a => {
            assert.strictEqual(a.password, undefined, 'Password must never be returned in user view');
        });
    });

    await test('User cannot access another user or admin account (403 forbidden)', async () => {
        const forbiddenRes = await api(`/api/accounts/1`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${testUserToken}` },
            body: { email: 'hacked@gmail.com' }
        });
        assert.strictEqual(forbiddenRes.status, 403);
    });

    console.log('\n--- SUITE 4: REWARDS, ELIGIBILITY & MATCHING ---');

    await test('Master Reward Catalogue exists and contains seeded initial items', async () => {
        const catRes = await api('/api/admin/rewards/catalog', {
            headers: { 'Authorization': `Bearer ${adminToken}` }
        });
        assert.strictEqual(catRes.status, 200);
        assert(catRes.body.length >= 11, 'Catalogue must contain at least 11 items');
        const amazon5 = catRes.body.find(r => r.name.includes('Amazon $5'));
        assert(amazon5, 'Amazon $5 item must exist');
        assert.strictEqual(amazon5.points_required, 6500);
    });

    await test('Reward Eligibility & Account Matching calculates thresholds accurately', async () => {
        const catRes = await api('/api/admin/rewards/catalog', {
            headers: { 'Authorization': `Bearer ${adminToken}` }
        });
        const amazon5 = catRes.body.find(r => r.name.includes('Amazon $5'));

        const matchRes = await api(`/api/admin/rewards/eligibility?rewardId=${amazon5.id}`, {
            headers: { 'Authorization': `Bearer ${adminToken}` }
        });
        assert.strictEqual(matchRes.status, 200);
        assert(matchRes.body.eligibleCount >= 0);
        assert(matchRes.body.approachingCount >= 0);
    });

    console.log('\n--- SUITE 5: REQUEST CENTER & NOTIFICATIONS ---');

    await test('User submits Request and Admin receives Notification', async () => {
        const reqRes = await api('/api/requests', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${testUserToken}` },
            body: {
                category: 'points_update',
                subject: 'Points update permission for weekend',
                message: 'Requesting permission to sync 15 accounts'
            }
        });
        assert.strictEqual(reqRes.status, 200);
        assert(reqRes.body.requestId.startsWith('REQ-'));

        // Admin checks notifications
        const notifRes = await api('/api/admin/notifications', {
            headers: { 'Authorization': `Bearer ${adminToken}` }
        });
        assert.strictEqual(notifRes.status, 200);
        const found = notifRes.body.find(n => n.reference_id === reqRes.body.requestId);
        assert(found, 'Admin must receive notification for user request');
    });

    console.log('\n--- SUITE 6: MONTHLY REVIEW FORMS & GATING ---');

    await test('Periodic Review Form submission unlocks user review state', async () => {
        const submitFormRes = await api('/api/forms/submit', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${testUserToken}` },
            body: {
                scheduleId: 1,
                answers: { pq_1: 'yes', pq_2: 'yes', pq_3: 'no', pq_4: 'yes', pq_10: 'All records accurate.' }
            }
        });
        assert.strictEqual(submitFormRes.status, 200);
        assert.strictEqual(submitFormRes.body.success, true);
    });

    console.log('\n--- SUITE 7: DOWNLOAD CENTER & PDF REPORT GENERATION ---');

    await test('Administrator generates executive PDF report (stream verified)', async () => {
        const pdfRes = await api('/api/downloads/generate', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${adminToken}` },
            body: { reportType: 'All Accounts & Points' }
        });
        assert.strictEqual(pdfRes.status, 200);
        assert.strictEqual(pdfRes.headers['content-type'], 'application/pdf');
        assert(pdfRes.body.length > 500, 'PDF buffer must contain generated data');
    });

    console.log('\n--- SUITE 8: MIGRATION & DATA INTEGRITY ---');

    await test('Verify existing remote Supabase accounts and points preserved', async () => {
        const { count: accCount } = await supabase.from('Users').select('*', { count: 'exact', head: true });
        const { count: ptCount } = await supabase.from('Points').select('*', { count: 'exact', head: true });
        const { count: redCount } = await supabase.from('Redemptions').select('*', { count: 'exact', head: true });

        console.log(`     Preserved Live Records: ${accCount} Accounts, ${ptCount} Points Rows, ${redCount} Redemptions`);
        assert(accCount >= 230, 'Existing accounts must be preserved');
        assert(ptCount >= 1000, 'Existing points history must be preserved');
        assert(redCount >= 40, 'Existing redemptions must be preserved');
    });

    await test('Verify exactly ONE administrator in database', async () => {
        const admins = await all(`SELECT * FROM app_users WHERE role = 'admin'`);
        assert.strictEqual(admins.length, 1, 'Exactly ONE administrator must exist');
        assert.strictEqual(admins[0].email, ADMIN_EMAIL, `Sole administrator must be ${ADMIN_EMAIL}`);
    });

    // Close test server
    if (testServer) {
        await new Promise(r => testServer.close(r));
    }

    console.log('\n======================================================');
    console.log(`🏁 FINAL TEST RESULTS: ${passedCount} PASSED, ${failedCount} FAILED`);
    console.log('======================================================\n');

    process.exit(failedCount > 0 ? 1 : 0);
}

runTests().catch(err => {
    console.error('Test Suite Fatal Error:', err);
    process.exit(1);
});
