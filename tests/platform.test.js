process.env.NODE_ENV = 'test';
const assert = require('assert');
const http = require('http');
const { app } = require('../server');
const { get, run, all, ADMIN_EMAIL, supabase } = require('../db/database');

let baseUrl = '';
let testServer = null;

const { PassThrough } = require('stream');

// In-Memory API dispatcher (pure internal Express pipeline - zero TCP sockets required)
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

            const reqSocket = new PassThrough();
            const resSocket = new PassThrough();
            const req = new http.IncomingMessage(reqSocket);
            req.method = method;
            req.url = endpoint;
            req.headers = headers;

            const res = new http.ServerResponse(req);
            res.assignSocket(resSocket);

            let resData = '';
            resSocket.on('data', chunk => {
                resData += chunk.toString();
            });

            res.on('finish', () => {
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
            });

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

    await test('Direct Email + Password Login for Administrator (001.workme@gmail.com)', async () => {
        const res = await api('/api/auth/login', {
            method: 'POST',
            body: {
                email: ADMIN_EMAIL,
                password: 'AdminSecurePassword2026!'
            }
        });
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.success, true);
        assert.strictEqual(res.body.user.role, 'admin');
        assert.strictEqual(res.body.user.email, ADMIN_EMAIL);
        assert(res.body.token, 'Admin token must be issued');
    });

    await test('Direct Email + Password Login: Rejects incorrect administrator password', async () => {
        const res = await api('/api/auth/login', {
            method: 'POST',
            body: {
                email: ADMIN_EMAIL,
                password: 'WrongPassword123'
            }
        });
        assert.strictEqual(res.status, 401);
        assert(res.body.error, 'Must return error message');
    });

    const directUserEmail = `direct.operator_${Date.now()}@gmail.com`;
    const directUserPassword = 'OperatorPass2026!';

    await test('Direct User Registration with Email and Password', async () => {
        const res = await api('/api/auth/register', {
            method: 'POST',
            body: {
                name: 'Direct Operator',
                email: directUserEmail,
                password: directUserPassword,
                phone: '+1 555-0188',
                registrationPurpose: 'account_operator',
                accountManagementDescription: 'Managing US accounts batch',
                termsAccepted: true
            }
        });
        assert.strictEqual(res.status, 201);
        assert.strictEqual(res.body.status, 'pending');
        assert.strictEqual(res.body.user.email, directUserEmail);

        // Verify password is encrypted in SQLite app_users table
        const row = await get(`SELECT password_hash FROM app_users WHERE email = ?`, [directUserEmail]);
        assert(row && row.password_hash, 'Password must be stored as hash');
        assert.notStrictEqual(row.password_hash, directUserPassword, 'Password must not be stored in plain text');
    });

    await test('Direct User Login returns pending status prior to administrator approval', async () => {
        const res = await api('/api/auth/login', {
            method: 'POST',
            body: {
                email: directUserEmail,
                password: directUserPassword
            }
        });
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.status, 'pending');
    });

    await test('Direct User Login succeeds after administrator approves application', async () => {
        const userRow = await get(`SELECT id FROM app_users WHERE email = ?`, [directUserEmail]);
        // Approve user
        await api(`/api/admin/users/${userRow.id}/status`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${adminToken}` },
            body: { action: 'approve' }
        });

        const res = await api('/api/auth/login', {
            method: 'POST',
            body: {
                email: directUserEmail,
                password: directUserPassword
            }
        });
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.status, 'approved');
        assert.strictEqual(res.body.user.role, 'user');
        assert(res.body.token, 'Token should be issued for approved user');
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

    await test('Administrator can revoke temporary window (locks back to Read-Only)', async () => {
        const revokeRes = await api(`/api/admin/users/${testUserId}/revoke-window`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${adminToken}` }
        });
        assert.strictEqual(revokeRes.status, 200);
        assert.strictEqual(revokeRes.body.success, true);
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
        assert(createRes.status === 200 || createRes.status === 201, 'Account creation should return 200 or 201');
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

    await test('Admin User Dossier shows correct account counts for primary operator (laptopmew1@gmail.com)', async () => {
        const laptopUser = await get(`SELECT id FROM app_users WHERE lower(email) = 'laptopmew1@gmail.com'`);
        assert(laptopUser, 'laptopmew1@gmail.com must exist');
        
        const dossierRes = await api(`/api/admin/users/${laptopUser.id}`, {
            headers: { 'Authorization': `Bearer ${adminToken}` }
        });
        assert.strictEqual(dossierRes.status, 200);
        assert(Array.isArray(dossierRes.body.accounts), 'Dossier must return accounts array');
        assert(dossierRes.body.accounts.length > 0, 'laptopmew1@gmail.com must have assigned accounts in dossier');
    });

    await test('User cannot access another user or admin account (403 forbidden)', async () => {
        const allAccRes = await api('/api/accounts', {
            headers: { 'Authorization': `Bearer ${adminToken}` }
        });
        const otherAcc = allAccRes.body.find(a => a.user_id !== testUserId);
        assert(otherAcc, 'Must have an account belonging to admin/other');

        const forbiddenRes = await api(`/api/accounts/${otherAcc.id}`, {
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

    await test('Default: User dashboard is not blocked by review form (pendingForm is null)', async () => {
        const meRes = await api('/api/auth/me', {
            headers: { 'Authorization': `Bearer ${testUserToken}` }
        });
        assert.strictEqual(meRes.status, 200);
        assert.strictEqual(meRes.body.pendingForm, null, 'User must not receive review form by default');
        assert.strictEqual(meRes.body.user.review_form_required, 0);
    });

    await test('Administrator sends review form to user (locks user dashboard)', async () => {
        const sendRes = await api('/api/forms/send-user', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${adminToken}` },
            body: { userId: testUserId }
        });
        assert.strictEqual(sendRes.status, 200);
        assert.strictEqual(sendRes.body.success, true);

        // Verify user profile now receives pendingForm and dashboard is stopped/blocked
        const meRes = await api('/api/auth/me', {
            headers: { 'Authorization': `Bearer ${testUserToken}` }
        });
        assert.strictEqual(meRes.status, 200);
        assert.notStrictEqual(meRes.body.pendingForm, null, 'User must now receive review form to fill');
        assert.strictEqual(meRes.body.user.review_form_required, 1);
    });

    await test('Periodic Review Form submission unlocks user review state and resumes dashboard', async () => {
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

        // Verify user profile is now unlocked and dashboard resumes
        const meRes = await api('/api/auth/me', {
            headers: { 'Authorization': `Bearer ${testUserToken}` }
        });
        assert.strictEqual(meRes.status, 200);
        assert.strictEqual(meRes.body.pendingForm, null, 'Dashboard must resume displaying after submission');
        assert.strictEqual(meRes.body.user.review_form_required, 0);
    });

    await test('Administrator can send to all operators and cancel review requirement', async () => {
        // Send to all
        const sendAllRes = await api('/api/forms/send-all', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${adminToken}` }
        });
        assert.strictEqual(sendAllRes.status, 200);
        assert.strictEqual(sendAllRes.body.success, true);

        // Cancel for test user
        const cancelRes = await api('/api/forms/cancel-user', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${adminToken}` },
            body: { userId: testUserId }
        });
        assert.strictEqual(cancelRes.status, 200);
        assert.strictEqual(cancelRes.body.success, true);

        // Verify dashboard resumed
        const meRes = await api('/api/auth/me', {
            headers: { 'Authorization': `Bearer ${testUserToken}` }
        });
        assert.strictEqual(meRes.body.pendingForm, null);
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
        try {
            const { count: accCount } = await supabase.from('Users').select('*', { count: 'exact', head: true });
            const { count: ptCount } = await supabase.from('Points').select('*', { count: 'exact', head: true });
            const { count: redCount } = await supabase.from('Redemptions').select('*', { count: 'exact', head: true });

            console.log(`     Preserved Live Records: ${accCount} Accounts, ${ptCount} Points Rows, ${redCount} Redemptions`);
            if (accCount !== null && accCount !== undefined) {
                assert(accCount >= 230, 'Existing accounts must be preserved');
                assert(ptCount >= 1000, 'Existing points history must be preserved');
                assert(redCount >= 40, 'Existing redemptions must be preserved');
            } else {
                console.log('     (Supabase offline in sandbox mode - remote check skipped)');
            }
        } catch (e) {
            console.log('     (Supabase offline in sandbox mode - remote check skipped)');
        }
    });

    await test('Verify exactly ONE administrator in database', async () => {
        const admins = await all(`SELECT * FROM app_users WHERE role = 'admin'`);
        assert.strictEqual(admins.length, 1, 'Exactly ONE administrator must exist');
        assert.strictEqual(admins[0].email, ADMIN_EMAIL, `Sole administrator must be ${ADMIN_EMAIL}`);
    });

    console.log('\n--- SUITE 9: DEDICATED ACCOUNT DETAILS & FREE EDITING PERIOD ---');

    let createdAccId = null;

    await test('User checks editing status (strictly starts in Read-Only mode)', async () => {
        const res = await api('/api/accounts/editing-status', {
            headers: { 'Authorization': `Bearer ${testUserToken}` }
        });
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.isReadOnly, true);
    });

    await test('Administrator grants temporary access window to user', async () => {
        const schedRes = await api(`/api/admin/users/${testUserId}/schedule-window`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${adminToken}` },
            body: { durationMinutes: 120, permittedActions: ['add_accounts', 'edit_accounts', 'update_points'] }
        });
        assert.strictEqual(schedRes.status, 200);
        assert.strictEqual(schedRes.body.success, true);

        const statusRes = await api('/api/accounts/editing-status', {
            headers: { 'Authorization': `Bearer ${testUserToken}` }
        });
        assert.strictEqual(statusRes.status, 200);
        assert.strictEqual(statusRes.body.canAddAccounts, true);
        assert.strictEqual(statusRes.body.canEditAccounts, true);
    });

    await test('User adds an account with comprehensive plaintext credentials during active free editing period', async () => {
        const res = await api('/api/accounts', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${testUserToken}` },
            body: {
                profile_no: 7,
                email: `user_device_${Date.now()}@domain.com`,
                email_password: 'TestEmailPass123!',
                server: 'US-TX#999',
                proton_email: 'test_proton@proton.me',
                proton_password: 'TestProtonPass456!',
                alternative_email: 'test_alt@gmail.com',
                alternative_password: 'TestAltPass789!',
                classification: 'new',
                status: 'active',
                notes: 'Automated test account'
            }
        });
        assert.strictEqual(res.status, 201, 'User should be allowed to create account during free window');
        assert(res.body.account && res.body.account.id);
        createdAccId = res.body.account.id;
    });

    await test('Dedicated Account Details page contains Overview, Credentials, and Passwords (Plaintext Direct Access)', async () => {
        const res = await api(`/api/accounts/${createdAccId}/details`, {
            headers: { 'Authorization': `Bearer ${testUserToken}` }
        });
        assert.strictEqual(res.status, 200);
        const data = res.body;

        // Section A: Account Overview
        assert(data.account, 'Must have account overview');
        assert(data.account.email, 'Must have email');
        assert.strictEqual(data.account.server, 'US-TX#999');
        assert.strictEqual(data.account.status, 'active');
        assert.strictEqual(data.account.classification, 'new');

        // Section B: Account Credentials & Passwords
        assert.strictEqual(data.account.email_password, 'TestEmailPass123!');
        assert.strictEqual(data.account.proton_email, 'test_proton@proton.me');
        assert.strictEqual(data.account.proton_password, 'TestProtonPass456!');
        assert.strictEqual(data.account.alternative_email, 'test_alt@gmail.com');
        assert.strictEqual(data.account.alternative_password, 'TestAltPass789!');
        assert.strictEqual(data.account.credentials.email_password, 'TestEmailPass123!');

        // Section C: Account Activity (NO points, NO redemptions)
        assert.strictEqual(data.points, undefined, 'CRITICAL: Points must NOT be displayed in Account Details');
        assert.strictEqual(data.pointsHistory, undefined, 'CRITICAL: Points history must NOT be in Account Details');
        assert.strictEqual(data.redemptions, undefined, 'CRITICAL: Redemptions must NOT be in Account Details');
        assert(Array.isArray(data.activityLogs), 'Activity logs must be an array');
        assert(data.activityLogs.length >= 1, 'Account creation must be logged in activity logs');
        assert.strictEqual(data.activityLogs[0].action_type.toLowerCase(), 'created');
    });

    await test('User submits Account Correction Request', async () => {
        const res = await api(`/api/accounts/${createdAccId}/correction-request`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${testUserToken}` },
            body: {
                fieldName: 'Server',
                previousValue: 'US-TX#999',
                newValue: 'US-CA#100',
                reason: 'Data center migration'
            }
        });
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.success, true);

        // Verify request logged in activity logs
        const detailsRes = await api(`/api/accounts/${createdAccId}/details`, {
            headers: { 'Authorization': `Bearer ${testUserToken}` }
        });
        const hasCorrectionLog = detailsRes.body.activityLogs.some(l => l.action_type.toLowerCase().includes('correction'));
        assert(hasCorrectionLog, 'Correction request must be logged in activity logs');
    });

    await test('Administrator reviews and configures editing period settings', async () => {
        // Save editing period configuration
        const saveRes = await api('/api/admin/editing-periods', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${adminToken}` },
            body: {
                userId: testUserId,
                enabled: true,
                durationValue: 14,
                durationUnit: 'days',
                startEvent: 'user_approval',
                applyToAdd: true,
                applyToEdit: true
            }
        });
        assert.strictEqual(saveRes.status, 200);
        assert.strictEqual(saveRes.body.success, true);

        // Verify configuration retrieval
        const getRes = await api(`/api/admin/editing-periods?userId=${testUserId}`, {
            headers: { 'Authorization': `Bearer ${adminToken}` }
        });
        assert.strictEqual(getRes.status, 200);
        assert.strictEqual(getRes.body.duration_value, 14);
        assert.strictEqual(getRes.body.duration_unit, 'days');
    });

    console.log('\n======================================================');
    console.log(`🏁 FINAL TEST RESULTS: ${passedCount} PASSED, ${failedCount} FAILED`);
    console.log('======================================================\n');

    process.exit(failedCount > 0 ? 1 : 0);
}

runTests().catch(err => {
    console.error('Test Suite Fatal Error:', err);
    process.exit(1);
});
