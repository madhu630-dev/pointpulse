// ==============================================================================
// POINTPULSE – FRONTEND APPLICATION CONTROLLER
// Enterprise Multi-User Architecture & Rewards Management
// ==============================================================================

let currentUser = null;
let currentToken = localStorage.getItem('pointpulse_token') || null;
let socket = null;
let currentActiveView = 'auth';
let activeUserDetailId = null;
let pendingRegistrationCredential = null;
let chartAdminPoints = null;
let chartAdminStatus = null;
let chartUserPoints = null;

// Initialize Socket.io
try {
    socket = io();
    socket.on('notification', (data) => {
        showToast(data.title, data.message, data.type || 'info');
        if (currentUser && currentUser.role === 'admin') {
            loadAdminNotifications();
        }
    });
    socket.on('new_admin_request', (data) => {
        if (currentUser && currentUser.role === 'admin') {
            showToast('New Request', `${data.user.name} submitted a ${data.category} request.`, 'warning');
            loadAdminNotifications();
        }
    });
    socket.on('user_status_changed', (data) => {
        if (currentUser && currentUser.id == data.userId) {
            checkSession();
        }
    });
} catch (e) {
    console.warn('Socket connection not available:', e);
}

// -----------------------------------------------------------------------------
// TOAST NOTIFICATIONS
// -----------------------------------------------------------------------------
function showToast(title, message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    let icon = 'fa-circle-check';
    if (type === 'danger') icon = 'fa-circle-xmark';
    if (type === 'warning') icon = 'fa-triangle-exclamation';
    if (type === 'info') icon = 'fa-circle-info';

    toast.innerHTML = `
        <i class="fa-solid ${icon}" style="font-size: 1.25rem;"></i>
        <div style="flex: 1;">
            <div style="font-weight: 700; font-size: 0.9rem; margin-bottom: 2px;">${escapeHtml(title)}</div>
            <div style="font-size: 0.82rem; color: var(--text-secondary); line-height: 1.4;">${escapeHtml(message)}</div>
        </div>
    `;

    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(40px)';
        setTimeout(() => toast.remove(), 300);
    }, 4500);
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// -----------------------------------------------------------------------------
// AUTHENTICATION & SESSION MANAGEMENT
// -----------------------------------------------------------------------------
async function checkSession() {
    if (!currentToken) {
        showView('auth');
        return;
    }

    try {
        const res = await fetch('/api/auth/me', {
            headers: { 'Authorization': `Bearer ${currentToken}` }
        });

        if (!res.ok) {
            logout();
            return;
        }

        const data = await res.json();
        currentUser = data.user;

        // Route by role & status
        if (currentUser.role === 'admin') {
            setupAdminDashboard();
        } else {
            if (currentUser.status === 'pending') {
                showPendingScreen(currentUser);
            } else if (currentUser.status === 'suspended') {
                showView('suspended');
            } else if (currentUser.status === 'rejected') {
                showToast('Registration Rejected', 'Your registration application was rejected.', 'danger');
                showView('auth');
            } else if (currentUser.status === 'approved') {
                setupUserDashboard(data.pendingForm);
            } else {
                showView('auth');
            }
        }
    } catch (e) {
        console.error('Session check failed:', e);
        showView('auth');
    }
}

let googleClientId = '';

// Fetch backend authentication configuration (Google Client ID)
async function loadAuthConfig() {
    try {
        const res = await fetch('/api/auth/config');
        if (res.ok) {
            const data = await res.json();
            googleClientId = data.googleClientId || '';
            initializeGoogleGSI();
        }
    } catch (e) {
        console.warn('Failed to fetch auth configuration:', e);
    }
}

// Initialize Google Identity Services (GSI)
function initializeGoogleGSI() {
    if (!googleClientId || !window.google || !google.accounts || !google.accounts.id) return;
    try {
        google.accounts.id.initialize({
            client_id: googleClientId,
            callback: handleGoogleCredentialResponse,
            auto_select: false,
            ux_mode: 'popup'
        });

        const btnContainer = document.getElementById('google-btn-container');
        if (btnContainer) {
            google.accounts.id.renderButton(btnContainer, {
                theme: 'outline',
                size: 'large',
                width: 360,
                text: 'continue_with',
                shape: 'rectangular',
                logo_alignment: 'center'
            });
        }
    } catch (err) {
        console.error('Google Identity initialization error:', err);
    }
}

// Google OAuth Handler (Callback from Google Identity Services)
window.handleGoogleCredentialResponse = async function(response) {
    if (!response || !response.credential) {
        showAuthError('Invalid Google credential received.');
        return;
    }
    await processGoogleLogin(response.credential);
};

// Initiate Google Login popup or prompt
function initiateGoogleLogin() {
    if (googleClientId && window.google && google.accounts && google.accounts.id) {
        try {
            google.accounts.id.prompt((notification) => {
                if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
                    console.log('Google prompt not displayed/skipped');
                }
            });
        } catch (e) {
            console.error('Google prompt exception:', e);
        }
    } else if (!googleClientId) {
        showAuthError('Google Client ID is not configured on the server. Please add GOOGLE_CLIENT_ID to your environment variables.');
    } else {
        showAuthError('Google Identity Services is loading. Please wait a moment and try again.');
    }
}

// Process Google Login on Backend
async function processGoogleLogin(credential) {
    const errorBanner = document.getElementById('auth-error-banner');
    if (errorBanner) errorBanner.classList.add('hidden');

    try {
        const res = await fetch('/api/auth/google', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ credential })
        });

        const data = await res.json();

        if (!res.ok) {
            showAuthError(data.error || 'Google authentication failed.');
            return;
        }

        // Needs registration form completion
        if (data.needsRegistration) {
            pendingRegistrationCredential = credential;
            showRegistrationForm(data.googleUser);
            return;
        }

        // Existing user
        currentToken = data.token;
        localStorage.setItem('pointpulse_token', currentToken);
        currentUser = data.user;

        if (currentUser.role === 'admin') {
            setupAdminDashboard();
            showToast('Welcome, Administrator', `Signed in as ${currentUser.email}`);
        } else if (currentUser.status === 'pending') {
            showPendingScreen(currentUser);
        } else if (currentUser.status === 'approved') {
            setupUserDashboard();
            showToast('Welcome Back', `Signed in as ${currentUser.name}`);
        } else {
            showView('auth');
        }

    } catch (error) {
        console.error('Auth processing error:', error);
        showAuthError('Unable to connect to authentication service.');
    }
}

function showAuthError(msg) {
    const banner = document.getElementById('auth-error-banner');
    const txt = document.getElementById('auth-error-text');
    if (banner && txt) {
        txt.textContent = msg;
        banner.classList.remove('hidden');
    }
}

// Display Registration Form
function showRegistrationForm(googleUser) {
    document.getElementById('reg-avatar').src = googleUser.picture || `https://ui-avatars.com/api/?name=${encodeURIComponent(googleUser.name)}`;
    document.getElementById('reg-name-display').textContent = googleUser.name;
    document.getElementById('reg-email-display').textContent = googleUser.email;
    document.getElementById('reg-display-name').value = googleUser.name;
    showView('registration');
}

// Submit Registration Form
async function submitRegistrationForm(event) {
    event.preventDefault();
    const displayName = document.getElementById('reg-display-name').value.trim();
    const phone = document.getElementById('reg-phone').value.trim();
    const purpose = document.getElementById('reg-purpose').value;
    const description = document.getElementById('reg-description').value.trim();
    const termsAccepted = document.getElementById('reg-terms-check').checked;

    if (!termsAccepted) {
        showToast('Terms Required', 'You must acknowledge the terms and privacy policy.', 'warning');
        return;
    }

    try {
        const res = await fetch('/api/auth/register-form', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                credential: pendingRegistrationCredential,
                displayName,
                phone,
                registrationPurpose: purpose,
                accountManagementDescription: description,
                termsAccepted: true
            })
        });

        const data = await res.json();
        if (!res.ok) {
            showToast('Registration Error', data.error || 'Failed to submit registration.', 'danger');
            return;
        }

        currentToken = data.token;
        localStorage.setItem('pointpulse_token', currentToken);
        currentUser = data.user;

        showPendingScreen(currentUser);
        showToast('Application Submitted', 'Your registration is pending administrator approval.', 'info');

    } catch (error) {
        console.error('Reg form error:', error);
        showToast('Error', 'Connection error while submitting application.', 'danger');
    }
}

// Display Pending Screen (Strictly NO dashboard data)
function showPendingScreen(user) {
    document.getElementById('pending-avatar').src = user.picture || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.name)}`;
    document.getElementById('pending-greeting').textContent = `Welcome, ${user.name}`;
    document.getElementById('pending-email-display').textContent = user.email;
    const subDate = user.submitted_at ? new Date(user.submitted_at).toLocaleString() : new Date().toLocaleString();
    document.getElementById('pending-submitted-date').textContent = `Application Submitted: ${subDate}`;
    showView('pending');
}

function logout() {
    if (currentToken) {
        fetch('/api/auth/logout', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${currentToken}` }
        }).catch(() => {});
    }
    currentToken = null;
    currentUser = null;
    localStorage.removeItem('pointpulse_token');
    showView('auth');
    showToast('Signed Out', 'You have been logged out securely.', 'info');
}

// View switcher
function showView(viewName) {
    currentActiveView = viewName;
    const views = ['auth', 'registration', 'pending', 'suspended', 'dashboard'];
    views.forEach(v => {
        const el = document.getElementById(`view-${v}`);
        if (el) el.classList.add('hidden');
    });

    const activeEl = document.getElementById(`view-${viewName}`);
    if (activeEl) activeEl.classList.remove('hidden');
}

// -----------------------------------------------------------------------------
// ADMIN DASHBOARD CONTROLLER
// -----------------------------------------------------------------------------
function setupAdminDashboard() {
    showView('dashboard');

    document.getElementById('admin-nav-container').classList.remove('hidden');
    document.getElementById('user-nav-container').classList.add('hidden');

    document.getElementById('nav-user-avatar').src = currentUser.picture || `https://ui-avatars.com/api/?name=Admin`;
    document.getElementById('nav-user-name').textContent = currentUser.name || 'Administrator';
    document.getElementById('nav-user-role').textContent = 'Administrator';
    document.getElementById('top-user-pill').textContent = `Admin: ${currentUser.email}`;

    setupNavigation('admin');
    showAdminPage('admin-overview');
    loadAdminOverview();
    loadAdminNotifications();
}

function setupNavigation(role) {
    const buttons = document.querySelectorAll('.sidebar-nav-btn');
    buttons.forEach(btn => {
        btn.onclick = () => {
            buttons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const targetPage = btn.getAttribute('data-page');
            if (role === 'admin') {
                showAdminPage(targetPage);
            } else {
                showUserPage(targetPage);
            }
        };
    });
}

function showAdminPage(pageId) {
    const pages = document.querySelectorAll('.page-pane');
    pages.forEach(p => p.classList.add('hidden'));

    const activePage = document.getElementById(`page-${pageId}`);
    if (activePage) activePage.classList.remove('hidden');

    const titleMap = {
        'admin-overview': 'Enterprise Overview & KPIs',
        'admin-users': 'User Management & Approvals',
        'admin-user-detail': 'Individual User Dossier',
        'admin-all-accounts': 'All Managed Accounts',
        'admin-classification': 'Old / New Classification Board',
        'admin-points-perms': 'Points Management & Permissions',
        'admin-catalog': 'Master Reward Catalogue',
        'admin-matching': 'Reward Eligibility & Account Matching',
        'admin-notifications': 'Notification Center',
        'admin-forms': 'Monthly Review Forms',
        'admin-downloads': 'Executive PDF Download Center',
        'admin-audit': 'Append-Only Audit Logs'
    };
    document.getElementById('current-view-title').textContent = titleMap[pageId] || 'Admin Dashboard';

    // Page-specific loaders
    if (pageId === 'admin-overview') loadAdminOverview();
    if (pageId === 'admin-users') loadAdminUsers();
    if (pageId === 'admin-all-accounts') loadAllAccounts();
    if (pageId === 'admin-classification') loadClassificationBoard();
    if (pageId === 'admin-catalog') loadAdminRewardCatalog();
    if (pageId === 'admin-matching') loadMatchingData();
    if (pageId === 'admin-notifications') loadAdminNotifications();
    if (pageId === 'admin-forms') loadAdminForms();
    if (pageId === 'admin-downloads') loadAdminDownloadSettings();
    if (pageId === 'admin-audit') loadAuditLogs();
}

// 1. Admin Overview
async function loadAdminOverview() {
    try {
        const res = await fetch('/api/admin/overview', {
            headers: { 'Authorization': `Bearer ${currentToken}` }
        });
        if (!res.ok) return;
        const data = await res.json();

        // Populate KPI Cards
        const kpiContainer = document.getElementById('admin-kpi-container');
        kpiContainer.innerHTML = `
            <div class="kpi-card kpi-secondary">
                <div class="kpi-title"><i class="fa-solid fa-users"></i> Platform Users</div>
                <div class="kpi-value">${data.users.total}</div>
                <div class="kpi-subtext">${data.users.approved} Approved • ${data.users.pending} Pending Review</div>
            </div>
            <div class="kpi-card kpi-success">
                <div class="kpi-title"><i class="fa-solid fa-list-check"></i> Active Accounts</div>
                <div class="kpi-value">${data.accounts.active}</div>
                <div class="kpi-subtext">Total Managed: ${data.accounts.total} • ${data.accounts.banned} Banned</div>
            </div>
            <div class="kpi-card">
                <div class="kpi-title"><i class="fa-solid fa-coins"></i> Total Point Records</div>
                <div class="kpi-value">${data.points.totalRecords.toLocaleString()}</div>
                <div class="kpi-subtext">${data.accounts.old} Old Accounts • ${data.accounts.new} New Accounts</div>
            </div>
            <div class="kpi-card kpi-warning">
                <div class="kpi-title"><i class="fa-solid fa-gift"></i> Confirmed Redemptions</div>
                <div class="kpi-value">${data.redemptions.total}</div>
                <div class="kpi-subtext">${data.pendingActions.pointsPermission + data.pendingActions.redemption} Pending Requests</div>
            </div>
        `;

        // Update pending badges
        const pendingBadge = document.getElementById('badge-pending-users');
        if (pendingBadge) {
            if (data.users.pending > 0) {
                pendingBadge.textContent = data.users.pending;
                pendingBadge.classList.remove('hidden');
            } else {
                pendingBadge.classList.add('hidden');
            }
        }

        // Render Overview Charts
        renderAdminCharts(data);

        // Recent Audit Table
        const auditBody = document.getElementById('admin-recent-audit-body');
        if (auditBody && data.recentLogs) {
            auditBody.innerHTML = data.recentLogs.map(log => `
                <tr>
                    <td><strong>${escapeHtml(log.actor_email || 'System')}</strong></td>
                    <td><span class="badge ${log.actor_role === 'admin' ? 'badge-primary' : 'badge-active'}">${log.actor_role}</span></td>
                    <td>${escapeHtml(log.action)}</td>
                    <td>${log.target_user_id ? 'User #' + log.target_user_id : '-'}</td>
                    <td><span class="badge badge-active">${log.result}</span></td>
                    <td class="text-secondary">${new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' })}</td>
                </tr>
            `).join('');
        }

    } catch (e) {
        console.error('Failed to load admin overview:', e);
    }
}

function renderAdminCharts(data) {
    const pointsCanvas = document.getElementById('chart-admin-points');
    const statusCanvas = document.getElementById('chart-admin-status');

    if (pointsCanvas) {
        if (chartAdminPoints) chartAdminPoints.destroy();
        chartAdminPoints = new Chart(pointsCanvas, {
            type: 'bar',
            data: {
                labels: ['0 - 5K pts', '5K - 6.5K pts', '6.5K - 10K pts', '10K - 13K pts', '13K+ pts'],
                datasets: [{
                    label: 'Accounts Count',
                    data: [77, 45, 36, 40, 34],
                    backgroundColor: '#6366f1',
                    borderRadius: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } },
                    y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } }
                }
            }
        });
    }

    if (statusCanvas) {
        if (chartAdminStatus) chartAdminStatus.destroy();
        chartAdminStatus = new Chart(statusCanvas, {
            type: 'doughnut',
            data: {
                labels: ['Active Accounts', 'Banned Accounts'],
                datasets: [{
                    data: [data.accounts.active, data.accounts.banned],
                    backgroundColor: ['#10b981', '#ef4444'],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { position: 'bottom', labels: { color: '#94a3b8' } } }
            }
        });
    }
}

// 2. Admin User Management
async function loadAdminUsers() {
    const search = document.getElementById('filter-user-search')?.value || '';
    const status = document.getElementById('filter-user-status')?.value || 'all';

    try {
        const res = await fetch(`/api/admin/users?search=${encodeURIComponent(search)}&status=${encodeURIComponent(status)}`, {
            headers: { 'Authorization': `Bearer ${currentToken}` }
        });
        if (!res.ok) return;
        const users = await res.json();

        const badge = document.getElementById('users-count-badge');
        if (badge) badge.textContent = `${users.length} Users`;

        const body = document.getElementById('admin-users-table-body');
        if (!body) return;

        if (users.length === 0) {
            body.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 2rem;">No registered users found.</td></tr>`;
            return;
        }

        body.innerHTML = users.map(u => {
            const statusClass = u.status === 'approved' ? 'badge-active' : (u.status === 'pending' ? 'badge-pending' : 'badge-banned');
            return `
                <tr>
                    <td>
                        <div style="display: flex; align-items: center; gap: 0.75rem;">
                            <img src="${u.picture || `https://ui-avatars.com/api/?name=${encodeURIComponent(u.name)}`}" style="width: 36px; height: 36px; border-radius: 50%; object-fit: cover;">
                            <div>
                                <div style="font-weight: 700;">${escapeHtml(u.name)}</div>
                                <div class="text-secondary" style="font-size: 0.8rem;">${escapeHtml(u.email)}</div>
                            </div>
                        </div>
                    </td>
                    <td class="text-secondary">${new Date(u.createdAt).toLocaleDateString()}</td>
                    <td><span class="badge ${statusClass}">${u.status.toUpperCase()}</span></td>
                    <td><strong>${u.activeAccountsCount}</strong> active</td>
                    <td class="text-danger">${u.bannedAccountsCount} banned</td>
                    <td style="color: var(--secondary-color); font-weight: 700;">${u.totalPoints.toLocaleString()} pts</td>
                    <td>
                        <div style="display: flex; gap: 0.4rem;">
                            <button class="btn secondary-btn" style="padding: 0.35rem 0.65rem; font-size: 0.78rem;" onclick="openUserDetails(${u.id})">
                                <i class="fa-solid fa-folder-open"></i> Details
                            </button>
                            ${u.status === 'pending' ? `
                                <button class="btn success-btn" style="padding: 0.35rem 0.65rem; font-size: 0.78rem;" onclick="adminUpdateUserStatus(${u.id}, 'approve')">
                                    <i class="fa-solid fa-check"></i> Approve
                                </button>
                                <button class="btn danger-btn" style="padding: 0.35rem 0.65rem; font-size: 0.78rem;" onclick="adminUpdateUserStatus(${u.id}, 'reject')">
                                    <i class="fa-solid fa-xmark"></i> Reject
                                </button>
                            ` : ''}
                            ${u.status === 'approved' ? `
                                <button class="btn danger-btn" style="padding: 0.35rem 0.65rem; font-size: 0.78rem;" onclick="adminUpdateUserStatus(${u.id}, 'suspend')">
                                    <i class="fa-solid fa-ban"></i> Suspend
                                </button>
                            ` : ''}
                            ${u.status === 'suspended' ? `
                                <button class="btn success-btn" style="padding: 0.35rem 0.65rem; font-size: 0.78rem;" onclick="adminUpdateUserStatus(${u.id}, 'reactivate')">
                                    <i class="fa-solid fa-rotate-right"></i> Reactivate
                                </button>
                            ` : ''}
                        </div>
                    </td>
                </tr>
            `;
        }).join('');

    } catch (e) {
        console.error('Failed to load users:', e);
    }
}

async function adminUpdateUserStatus(userId, action) {
    if (!confirm(`Are you sure you want to ${action} this user?`)) return;

    try {
        const res = await fetch(`/api/admin/users/${userId}/status`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentToken}`
            },
            body: JSON.stringify({ action })
        });
        const data = await res.json();
        if (res.ok) {
            showToast('User Updated', data.message);
            loadAdminUsers();
            loadAdminOverview();
        } else {
            showToast('Error', data.error || 'Failed to update user', 'danger');
        }
    } catch (e) {
        showToast('Error', 'Action failed', 'danger');
    }
}

// 3. Open User Dossier (12 Tabs)
async function openUserDetails(userId) {
    activeUserDetailId = userId;
    showAdminPage('admin-user-detail');

    try {
        const res = await fetch(`/api/admin/users/${userId}`, {
            headers: { 'Authorization': `Bearer ${currentToken}` }
        });
        if (!res.ok) return;
        const data = await res.json();

        document.getElementById('detail-user-header').textContent = `${data.user.name} (${data.user.email})`;
        const badgeClass = data.user.status === 'approved' ? 'badge-active' : (data.user.status === 'pending' ? 'badge-pending' : 'badge-banned');
        document.getElementById('detail-user-status-badge').innerHTML = `<span class="badge ${badgeClass}">${data.user.status.toUpperCase()}</span>`;

        window._activeUserDetails = data;
        switchUserTab('summary');
    } catch (e) {
        console.error('Error loading user details:', e);
    }
}

function switchUserTab(tabName) {
    const tabButtons = document.querySelectorAll('.tabs-nav .tab-btn');
    tabButtons.forEach(btn => btn.classList.remove('active'));
    event?.target?.closest('.tab-btn')?.classList.add('active');

    const container = document.getElementById('user-tab-content-container');
    const data = window._activeUserDetails;
    if (!data) return;

    if (tabName === 'summary') {
        container.innerHTML = `
            <div class="kpi-grid">
                <div class="kpi-card"><div class="kpi-title">Managed Accounts</div><div class="kpi-value">${data.accounts.length}</div></div>
                <div class="kpi-card kpi-success"><div class="kpi-title">Active Accounts</div><div class="kpi-value">${data.accounts.filter(a => a.status === 'active').length}</div></div>
                <div class="kpi-card kpi-warning"><div class="kpi-title">Confirmed Redemptions</div><div class="kpi-value">${data.redemptions.length}</div></div>
                <div class="kpi-card kpi-secondary"><div class="kpi-title">Active Permissions</div><div class="kpi-value">${data.permissions.length}</div></div>
            </div>
            <div class="table-card" style="padding: 1.5rem;">
                <h4 style="font-weight: 700; margin-bottom: 1rem;">Registration Profile Dossier</h4>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; font-size: 0.9rem;">
                    <div><strong>Google Email:</strong> <span class="text-secondary">${data.user.email}</span></div>
                    <div><strong>Display Name:</strong> <span class="text-secondary">${data.user.displayName || '-'}</span></div>
                    <div><strong>Phone:</strong> <span class="text-secondary">${data.user.phone || '-'}</span></div>
                    <div><strong>Registered On:</strong> <span class="text-secondary">${new Date(data.user.createdAt).toLocaleString()}</span></div>
                    <div style="grid-column: span 2;"><strong>Registration Purpose:</strong> <p class="text-secondary" style="margin-top: 4px;">${escapeHtml(data.user.registrationPurpose || '-')}</p></div>
                    <div style="grid-column: span 2;"><strong>Account Management Description:</strong> <p class="text-secondary" style="margin-top: 4px;">${escapeHtml(data.user.accountManagementDescription || '-')}</p></div>
                </div>
            </div>
        `;
    } else if (tabName === 'active' || tabName === 'banned' || tabName === 'old' || tabName === 'new') {
        let filtered = data.accounts;
        if (tabName === 'active') filtered = data.accounts.filter(a => a.status === 'active');
        if (tabName === 'banned') filtered = data.accounts.filter(a => a.status === 'banned');
        if (tabName === 'old') filtered = data.accounts.filter(a => a.classification === 'old');
        if (tabName === 'new') filtered = data.accounts.filter(a => a.classification === 'new');

        container.innerHTML = `
            <div class="table-card">
                <div class="table-header-bar">
                    <h4 style="font-weight: 700;">${tabName.toUpperCase()} Accounts (${filtered.length})</h4>
                </div>
                <div class="table-responsive">
                    <table class="modern-table">
                        <thead>
                            <tr><th>Prof #</th><th>Email</th><th>Server</th><th>Classification</th><th>Status</th></tr>
                        </thead>
                        <tbody>
                            ${filtered.length === 0 ? '<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">No accounts in this category.</td></tr>' : 
                            filtered.map(a => `
                                <tr>
                                    <td><strong>P${a.profile_no || '-'}</strong></td>
                                    <td>${escapeHtml(a.email)}</td>
                                    <td class="text-secondary">${a.server || '-'}</td>
                                    <td><span class="badge badge-primary">${(a.classification || 'new').toUpperCase()}</span></td>
                                    <td><span class="badge ${a.status === 'active' ? 'badge-active' : 'badge-banned'}">${a.status.toUpperCase()}</span></td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    } else if (tabName === 'permissions') {
        const permsList = [
            { key: 'view_accounts', label: 'View Accounts' },
            { key: 'add_accounts', label: 'Add Accounts' },
            { key: 'edit_accounts', label: 'Edit Account Details' },
            { key: 'update_points', label: 'Update Points' },
            { key: 'import_excel', label: 'Import Excel Data' },
            { key: 'view_redemption', label: 'View Redemption' },
            { key: 'download_reports', label: 'Download Reports' },
            { key: 'view_old_accounts', label: 'View Old Accounts' },
            { key: 'view_new_accounts', label: 'View New Accounts' },
            { key: 'submit_requests', label: 'Submit Requests' }
        ];

        const userPermKeys = data.permissions.map(p => p.permission_key);

        container.innerHTML = `
            <div class="table-card" style="padding: 1.5rem;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
                    <div>
                        <h4 style="font-weight: 700;">Granular Permissions</h4>
                        <p class="text-secondary" style="font-size: 0.85rem;">Enforce strict backend authorization for every action.</p>
                    </div>
                    <button class="btn secondary-btn" onclick="openTempWindowModal(${data.user.id}, '${escapeHtml(data.user.name)}')">
                        <i class="fa-solid fa-clock"></i> Grant Temp Window
                    </button>
                </div>
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 1rem; margin-bottom: 1.5rem;">
                    ${permsList.map(p => `
                        <label style="display: flex; align-items: center; gap: 0.75rem; background: var(--bg-color); padding: 0.85rem 1rem; border-radius: 8px; border: 1px solid var(--border-color); cursor: pointer;">
                            <input type="checkbox" class="perm-check" value="${p.key}" ${userPermKeys.includes(p.key) ? 'checked' : ''} style="width: 18px; height: 18px; accent-color: var(--primary-color);">
                            <span style="font-weight: 600; font-size: 0.9rem;">${p.label}</span>
                        </label>
                    `).join('')}
                </div>
                <button class="btn primary-btn" onclick="saveUserPermissions(${data.user.id})">Save Permissions</button>
            </div>
        `;
    } else if (tabName === 'settings') {
        const vis = data.rewardVisibility;
        container.innerHTML = `
            <div class="table-card" style="padding: 1.5rem;">
                <h4 style="font-weight: 700; margin-bottom: 1rem;">Per-User Reward Catalogue Visibility</h4>
                <p class="text-secondary" style="font-size: 0.88rem; margin-bottom: 1.5rem;">Control which rewards this specific user can see on their dashboard.</p>
                
                <div style="margin-bottom: 1.5rem;">
                    <label style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.75rem; cursor: pointer;">
                        <input type="radio" name="rw-mode" value="all" ${vis.mode === 'all' ? 'checked' : ''}>
                        <span><strong>OPTION A:</strong> Display all published reward items</span>
                    </label>
                    <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer;">
                        <input type="radio" name="rw-mode" value="selected" ${vis.mode === 'selected' ? 'checked' : ''}>
                        <span><strong>OPTION B:</strong> Display only selected items</span>
                    </label>
                </div>
                <button class="btn primary-btn" onclick="saveUserRewardVisibility(${data.user.id})">Save Settings</button>
            </div>
        `;
    } else {
        container.innerHTML = `<div class="table-card" style="padding: 2rem; text-align: center; color: var(--text-muted);">Tab data loading or empty.</div>`;
    }
}

async function saveUserPermissions(userId) {
    const checks = document.querySelectorAll('.perm-check:checked');
    const perms = Array.from(checks).map(c => c.value);

    try {
        const res = await fetch(`/api/admin/users/${userId}/permissions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentToken}` },
            body: JSON.stringify({ permissions: perms })
        });
        if (res.ok) {
            showToast('Permissions Saved', 'Updated user access permissions successfully.');
        } else {
            showToast('Error', 'Failed to update permissions', 'danger');
        }
    } catch (e) {
        showToast('Error', 'Save failed', 'danger');
    }
}

// 4. Drag & Drop Old / New Classification Board
async function loadClassificationBoard() {
    try {
        const res = await fetch('/api/accounts', {
            headers: { 'Authorization': `Bearer ${currentToken}` }
        });
        if (!res.ok) return;
        const accounts = await res.json();

        const oldAccounts = accounts.filter(a => a.classification === 'old');
        const newAccounts = accounts.filter(a => a.classification !== 'old');

        document.getElementById('count-old-accounts').textContent = oldAccounts.length;
        document.getElementById('count-new-accounts').textContent = newAccounts.length;

        const renderCards = (accList) => accList.map(a => `
            <div class="drag-card" draggable="true" ondragstart="dragStart(event, ${a.id})">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <strong>P${a.profile_no || '-'} • ${escapeHtml(a.email.split('@')[0])}</strong>
                    <span style="color: var(--secondary-color); font-weight: 700; font-size: 0.82rem;">${a.current_points.toLocaleString()} pts</span>
                </div>
                <div class="text-secondary" style="font-size: 0.78rem; margin-top: 4px;">${escapeHtml(a.email)}</div>
            </div>
        `).join('');

        document.getElementById('list-old-accounts').innerHTML = renderCards(oldAccounts);
        document.getElementById('list-new-accounts').innerHTML = renderCards(newAccounts);

    } catch (e) {
        console.error('Classification load error:', e);
    }
}

window.dragStart = function(event, accountId) {
    event.dataTransfer.setData('text/plain', accountId);
};
window.allowDrop = function(event) {
    event.preventDefault();
    event.currentTarget.classList.add('drag-over');
};
window.dragLeave = function(event) {
    event.currentTarget.classList.remove('drag-over');
};
window.handleDrop = async function(event, targetClassification) {
    event.preventDefault();
    event.currentTarget.classList.remove('drag-over');
    const accountId = event.dataTransfer.getData('text/plain');
    if (!accountId) return;

    try {
        const res = await fetch('/api/admin/accounts/reclassify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentToken}` },
            body: JSON.stringify({ accountIds: [Number(accountId)], targetClassification })
        });
        if (res.ok) {
            showToast('Reclassified', `Account moved to ${targetClassification.toUpperCase()} accounts.`);
            loadClassificationBoard();
        }
    } catch (e) {
        showToast('Error', 'Failed to move account', 'danger');
    }
};

// 5. Reward Catalogue (Admin)
async function loadAdminRewardCatalog() {
    try {
        const res = await fetch('/api/admin/rewards/catalog', {
            headers: { 'Authorization': `Bearer ${currentToken}` }
        });
        if (!res.ok) return;
        const rewards = await res.json();

        const container = document.getElementById('admin-rewards-container');
        if (!container) return;

        container.innerHTML = rewards.map(r => `
            <div class="reward-card">
                <div class="reward-card-header">
                    <div>
                        <div class="reward-name">${escapeHtml(r.name)}</div>
                        <div class="text-secondary" style="font-size: 0.85rem; margin-top: 2px;">Display: ${escapeHtml(r.user_display)}</div>
                    </div>
                    <span class="badge ${r.is_published ? 'badge-active' : 'badge-banned'}">${r.is_published ? 'Published' : 'Hidden'}</span>
                </div>
                <div class="reward-cost">${r.points_required.toLocaleString()} points required</div>
                <div style="display: flex; gap: 0.5rem; margin-top: 1.25rem;">
                    <button class="btn secondary-btn" style="padding: 0.35rem 0.75rem; font-size: 0.8rem;" onclick="editRewardItem(${JSON.stringify(r).replace(/"/g, '&quot;')})">
                        <i class="fa-solid fa-pen"></i> Edit
                    </button>
                </div>
            </div>
        `).join('');

    } catch (e) {
        console.error('Failed to load rewards:', e);
    }
}

function openRewardModal() {
    document.getElementById('rw-id').value = '';
    document.getElementById('rw-name').value = '';
    document.getElementById('rw-points').value = '';
    document.getElementById('rw-display').value = '';
    document.getElementById('rw-published').value = '1';
    document.getElementById('modal-reward-title').textContent = 'Add Master Reward Item';
    openModal('modal-reward-edit');
}

function editRewardItem(r) {
    document.getElementById('rw-id').value = r.id;
    document.getElementById('rw-name').value = r.name;
    document.getElementById('rw-points').value = r.points_required;
    document.getElementById('rw-display').value = r.user_display;
    document.getElementById('rw-published').value = r.is_published ? '1' : '0';
    document.getElementById('modal-reward-title').textContent = 'Edit Reward Item';
    openModal('modal-reward-edit');
}

async function saveRewardCatalogItem() {
    const id = document.getElementById('rw-id').value;
    const name = document.getElementById('rw-name').value.trim();
    const pointsRequired = parseInt(document.getElementById('rw-points').value);
    const userDisplay = document.getElementById('rw-display').value.trim();
    const isPublished = document.getElementById('rw-published').value === '1';

    if (!name || isNaN(pointsRequired)) {
        showToast('Required', 'Please fill name and points.', 'warning');
        return;
    }

    try {
        const res = await fetch('/api/admin/rewards/item', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentToken}` },
            body: JSON.stringify({ id: id || undefined, name, pointsRequired, userDisplay, isPublished })
        });
        if (res.ok) {
            closeModal('modal-reward-edit');
            showToast('Saved', 'Reward catalogue item updated.');
            loadAdminRewardCatalog();
        }
    } catch (e) {
        showToast('Error', 'Save failed', 'danger');
    }
}

// 6. Matching Accounts Data
async function loadMatchingData() {
    try {
        const [rewardsRes, usersRes] = await Promise.all([
            fetch('/api/admin/rewards/catalog', { headers: { 'Authorization': `Bearer ${currentToken}` } }),
            fetch('/api/admin/users', { headers: { 'Authorization': `Bearer ${currentToken}` } })
        ]);
        const rewards = await rewardsRes.json();
        const users = await usersRes.json();

        const rewardSelect = document.getElementById('match-reward-select');
        rewardSelect.innerHTML = rewards.map(r => `<option value="${r.id}">${escapeHtml(r.name)} (${r.points_required.toLocaleString()} pts)</option>`).join('');

        const userSelect = document.getElementById('match-user-select');
        userSelect.innerHTML = '<option value="">All Platform Users</option>' + users.map(u => `<option value="${u.id}">${escapeHtml(u.name)} (${escapeHtml(u.email)})</option>`).join('');

        runRewardMatching();
    } catch (e) {}
}

async function runRewardMatching() {
    const rewardId = document.getElementById('match-reward-select')?.value;
    const userId = document.getElementById('match-user-select')?.value;
    if (!rewardId) return;

    try {
        const res = await fetch(`/api/admin/rewards/eligibility?rewardId=${rewardId}&userId=${userId || ''}`, {
            headers: { 'Authorization': `Bearer ${currentToken}` }
        });
        if (!res.ok) return;
        const data = await res.json();

        document.getElementById('match-eligible-count').textContent = data.eligibleCount;
        document.getElementById('match-approaching-count').textContent = data.approachingCount;

        const eligibleBody = document.getElementById('match-eligible-body');
        eligibleBody.innerHTML = data.eligible.length === 0 ? '<tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">No accounts meet this threshold.</td></tr>' :
            data.eligible.map(a => `
                <tr>
                    <td><strong>P${a.profileNo || '-'}</strong></td>
                    <td>${escapeHtml(a.email)}</td>
                    <td style="color: var(--success-color); font-weight: 700;">${a.currentPoints.toLocaleString()}</td>
                    <td style="color: var(--secondary-color);">+${a.pointsAbove.toLocaleString()} pts</td>
                </tr>
            `).join('');

        const approachingBody = document.getElementById('match-approaching-body');
        approachingBody.innerHTML = data.approaching.length === 0 ? '<tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">No accounts close to threshold.</td></tr>' :
            data.approaching.map(a => `
                <tr>
                    <td><strong>P${a.profileNo || '-'}</strong></td>
                    <td>${escapeHtml(a.email)}</td>
                    <td>${a.currentPoints.toLocaleString()}</td>
                    <td class="text-warning">Remaining: ${a.remainingPoints.toLocaleString()} pts</td>
                </tr>
            `).join('');

    } catch (e) {}
}

// 7. Notification Center (Admin)
async function loadAdminNotifications() {
    try {
        const res = await fetch('/api/admin/notifications', {
            headers: { 'Authorization': `Bearer ${currentToken}` }
        });
        if (!res.ok) return;
        const notifs = await res.json();

        const unreadCount = notifs.filter(n => !n.is_read).length;
        const topBellBadge = document.getElementById('top-bell-badge');
        const adminNotifsBadge = document.getElementById('badge-admin-notifs');

        if (topBellBadge) {
            topBellBadge.textContent = unreadCount;
            if (unreadCount > 0) topBellBadge.classList.remove('hidden');
            else topBellBadge.classList.add('hidden');
        }
        if (adminNotifsBadge) {
            adminNotifsBadge.textContent = unreadCount;
            if (unreadCount > 0) adminNotifsBadge.classList.remove('hidden');
            else adminNotifsBadge.classList.add('hidden');
        }

        const listContainer = document.getElementById('admin-notifications-list');
        if (!listContainer) return;

        if (notifs.length === 0) {
            listContainer.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 2rem;">No notifications recorded.</div>`;
            return;
        }

        listContainer.innerHTML = notifs.map(n => `
            <div style="background: var(--bg-color); border: 1px solid var(--border-color); padding: 1.25rem; border-radius: 8px; border-left: 4px solid ${n.is_read ? 'var(--border-color)' : 'var(--primary-color)'};">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.5rem;">
                    <div>
                        <strong style="font-size: 0.95rem;">${escapeHtml(n.title)}</strong>
                        <span class="badge badge-primary" style="margin-left: 8px; font-size: 0.7rem;">${n.category}</span>
                    </div>
                    <span class="text-muted" style="font-size: 0.78rem;">${new Date(n.created_at).toLocaleString()}</span>
                </div>
                <p class="text-secondary" style="font-size: 0.88rem; line-height: 1.4;">${escapeHtml(n.message)}</p>
                ${!n.is_read ? `
                    <button class="btn secondary-btn" style="padding: 0.3rem 0.6rem; font-size: 0.75rem; margin-top: 0.75rem;" onclick="markNotificationRead(${n.id})">
                        <i class="fa-solid fa-check"></i> Mark as Reviewed
                    </button>
                ` : ''}
            </div>
        `).join('');

    } catch (e) {}
}

async function markNotificationRead(id) {
    try {
        await fetch(`/api/admin/notifications/${id}/read`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${currentToken}` }
        });
        loadAdminNotifications();
    } catch (e) {}
}

// 8. Monthly Reviews (Admin)
async function loadAdminForms() {
    try {
        const [schRes, subRes] = await Promise.all([
            fetch('/api/forms/active', { headers: { 'Authorization': `Bearer ${currentToken}` } }),
            fetch('/api/forms/submissions', { headers: { 'Authorization': `Bearer ${currentToken}` } })
        ]);
        const schedule = await schRes.json();
        const submissions = await subRes.json();

        const schCard = document.getElementById('admin-form-schedule-card');
        if (schCard && schedule.active) {
            schCard.innerHTML = `
                <div style="background: var(--bg-color); border: 1px solid var(--border-color); border-radius: 8px; padding: 1.25rem;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
                        <strong>${escapeHtml(schedule.title)}</strong>
                        <span class="badge badge-active">Active Schedule (Deadline: ${schedule.deadlineDay}th)</span>
                    </div>
                    <p class="text-secondary" style="font-size: 0.85rem; margin-bottom: 1rem;">Configured with ${schedule.questions.length} mandatory review questions.</p>
                </div>
            `;
        }

        const subBody = document.getElementById('admin-form-submissions-body');
        if (subBody) {
            subBody.innerHTML = submissions.length === 0 ? '<tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">No submissions yet.</td></tr>' :
                submissions.map(s => `
                    <tr>
                        <td><strong>${escapeHtml(s.user_name)}</strong> <span class="text-secondary">(${escapeHtml(s.user_email)})</span></td>
                        <td>${new Date(s.submitted_at).toLocaleString()}</td>
                        <td><span class="badge badge-active">${s.status.toUpperCase()}</span></td>
                        <td>
                            <button class="btn secondary-btn" style="padding: 0.35rem 0.65rem; font-size: 0.78rem;" onclick="viewSubmissionAnswers(${JSON.stringify(s.answers).replace(/"/g, '&quot;')})">
                                View Answers
                            </button>
                        </td>
                    </tr>
                `).join('');
        }
    } catch (e) {}
}

function viewSubmissionAnswers(answers) {
    alert(JSON.stringify(answers, null, 2));
}

// 9. Download Center
async function loadAdminDownloadSettings() {
    try {
        const res = await fetch('/api/admin/users', { headers: { 'Authorization': `Bearer ${currentToken}` } });
        const users = await res.json();
        const targetSelect = document.getElementById('dl-target-user');
        if (targetSelect) {
            targetSelect.innerHTML = '<option value="">All Platform Users</option>' + users.map(u => `<option value="${u.id}">${escapeHtml(u.name)} (${escapeHtml(u.email)})</option>`).join('');
        }
    } catch (e) {}
}

async function generatePdfReport() {
    const reportType = document.getElementById('dl-report-type')?.value;
    const userId = document.getElementById('dl-target-user')?.value;
    const statusFilter = document.getElementById('dl-status-filter')?.value;
    const classificationFilter = document.getElementById('dl-class-filter')?.value;

    showToast('Generating PDF', 'Compiling PointPulse branded PDF report...');

    try {
        const res = await fetch('/api/downloads/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentToken}` },
            body: JSON.stringify({ reportType, userId: userId || undefined, statusFilter, classificationFilter })
        });
        if (!res.ok) throw new Error('PDF generation failed');

        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `PointPulse_Report_${Date.now()}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        showToast('Download Ready', 'PDF report downloaded successfully.');
    } catch (e) {
        showToast('Error', 'Failed to generate PDF report', 'danger');
    }
}

async function downloadCsvExport() {
    window.location.href = `/api/accounts/export/csv?token=${encodeURIComponent(currentToken)}`;
}

// 10. Audit Logs
async function loadAuditLogs() {
    const search = document.getElementById('audit-search')?.value || '';
    try {
        const res = await fetch(`/api/admin/audit-logs?search=${encodeURIComponent(search)}`, {
            headers: { 'Authorization': `Bearer ${currentToken}` }
        });
        if (!res.ok) return;
        const logs = await res.json();

        const body = document.getElementById('admin-audit-table-body');
        if (!body) return;

        body.innerHTML = logs.map(l => `
            <tr>
                <td><strong>${escapeHtml(l.actor_email || 'System')}</strong></td>
                <td><span class="badge ${l.actor_role === 'admin' ? 'badge-primary' : 'badge-active'}">${l.actor_role}</span></td>
                <td>${escapeHtml(l.action)}</td>
                <td class="text-secondary" style="font-family: monospace; font-size: 0.75rem;">${escapeHtml(l.previous_value || '-')}</td>
                <td class="text-secondary" style="font-family: monospace; font-size: 0.75rem;">${escapeHtml(l.new_value || '-')}</td>
                <td><span class="badge badge-active">${l.result}</span></td>
                <td class="text-secondary">${new Date(l.created_at).toLocaleString()}</td>
            </tr>
        `).join('');
    } catch (e) {}
}

// -----------------------------------------------------------------------------
// USER DASHBOARD CONTROLLER
// -----------------------------------------------------------------------------
function setupUserDashboard(pendingForm) {
    showView('dashboard');

    document.getElementById('admin-nav-container').classList.add('hidden');
    document.getElementById('user-nav-container').classList.remove('hidden');

    document.getElementById('nav-user-avatar').src = currentUser.picture || `https://ui-avatars.com/api/?name=${encodeURIComponent(currentUser.name)}`;
    document.getElementById('nav-user-name').textContent = currentUser.name;
    document.getElementById('nav-user-role').textContent = 'Operator';
    document.getElementById('top-user-pill').textContent = `User: ${currentUser.email}`;

    // If a periodic monthly review form is pending, activate the full-screen gate!
    if (pendingForm) {
        activateFormGate(pendingForm);
    } else {
        deactivateFormGate();
    }

    setupNavigation('user');
    showUserPage('user-overview');
    loadUserOverview();
}

function showUserPage(pageId) {
    const pages = document.querySelectorAll('.page-pane');
    pages.forEach(p => p.classList.add('hidden'));

    const activePage = document.getElementById(`page-${pageId}`);
    if (activePage) activePage.classList.remove('hidden');

    const titleMap = {
        'user-overview': 'My Performance Overview',
        'user-active-accounts': 'My Active Accounts',
        'user-banned-accounts': 'My Banned Accounts',
        'user-classified-accounts': 'Old & New Accounts',
        'user-rewards': 'Available Rewards & Eligibility',
        'user-requests': 'My Request Center',
        'user-downloads': 'Authorized Reports Download'
    };
    document.getElementById('current-view-title').textContent = titleMap[pageId] || 'User Dashboard';

    if (pageId === 'user-overview') loadUserOverview();
    if (pageId === 'user-active-accounts') loadUserAccounts();
    if (pageId === 'user-banned-accounts') loadUserAccounts();
    if (pageId === 'user-classified-accounts') loadUserAccounts();
    if (pageId === 'user-rewards') loadUserRewards();
    if (pageId === 'user-requests') loadUserRequests();
}

// User Overview
async function loadUserOverview() {
    try {
        const [accRes, reqRes, rwRes] = await Promise.all([
            fetch('/api/accounts', { headers: { 'Authorization': `Bearer ${currentToken}` } }),
            fetch('/api/requests', { headers: { 'Authorization': `Bearer ${currentToken}` } }),
            fetch('/api/rewards', { headers: { 'Authorization': `Bearer ${currentToken}` } })
        ]);

        const accounts = await accRes.json();
        const requests = await reqRes.json();
        const rewards = await rwRes.json();

        const activeAcc = accounts.filter(a => a.status === 'active');
        let totalPts = 0;
        activeAcc.forEach(a => totalPts += a.current_points);

        const kpiContainer = document.getElementById('user-kpi-container');
        kpiContainer.innerHTML = `
            <div class="kpi-card kpi-success">
                <div class="kpi-title">Active Accounts</div>
                <div class="kpi-value">${activeAcc.length}</div>
                <div class="kpi-subtext">Assigned to your profile</div>
            </div>
            <div class="kpi-card kpi-secondary">
                <div class="kpi-title">Total Points Balance</div>
                <div class="kpi-value">${totalPts.toLocaleString()}</div>
                <div class="kpi-subtext">Across active accounts</div>
            </div>
            <div class="kpi-card">
                <div class="kpi-title">Available Rewards</div>
                <div class="kpi-value">${rewards.length}</div>
                <div class="kpi-subtext">Published by Administrator</div>
            </div>
            <div class="kpi-card kpi-warning">
                <div class="kpi-title">Pending Requests</div>
                <div class="kpi-value">${requests.filter(r => r.status === 'Pending').length}</div>
                <div class="kpi-subtext">Tracked in Request Center</div>
            </div>
        `;

        renderUserPointsChart(activeAcc);
    } catch (e) {}
}

function renderUserPointsChart(accounts) {
    const canvas = document.getElementById('chart-user-points');
    if (!canvas) return;

    if (chartUserPoints) chartUserPoints.destroy();
    const sorted = [...accounts].sort((a,b) => b.current_points - a.current_points).slice(0, 10);

    chartUserPoints = new Chart(canvas, {
        type: 'bar',
        data: {
            labels: sorted.map(a => `P${a.profile_no || '-'}`),
            datasets: [{
                label: 'Points',
                data: sorted.map(a => a.current_points),
                backgroundColor: '#22d3ee',
                borderRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } },
                y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } }
            }
        }
    });
}

// User Accounts Table (NO TAG COLUMN!)
async function loadUserAccounts() {
    try {
        const res = await fetch('/api/accounts', {
            headers: { 'Authorization': `Bearer ${currentToken}` }
        });
        if (!res.ok) return;
        const accounts = await res.json();
        window._userAccounts = accounts;

        filterUserActiveTable();
    } catch (e) {}
}

function filterUserActiveTable() {
    const accounts = window._userAccounts || [];
    const search = document.getElementById('user-acc-search')?.value.toLowerCase() || '';

    const activeList = accounts.filter(a => a.status === 'active' && a.email.toLowerCase().includes(search));
    const bannedList = accounts.filter(a => a.status === 'banned');

    const activeBody = document.getElementById('user-active-accounts-body');
    if (activeBody) {
        activeBody.innerHTML = activeList.length === 0 ? '<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">No active accounts found.</td></tr>' :
            activeList.map(a => `
                <tr>
                    <td><strong>P${a.profile_no || '-'}</strong></td>
                    <td>${escapeHtml(a.email)}</td>
                    <td class="text-secondary">${a.server || '-'}</td>
                    <td style="color: var(--secondary-color); font-weight: 700;">${a.current_points.toLocaleString()}</td>
                    <td><span class="badge badge-primary">${(a.classification || 'new').toUpperCase()}</span></td>
                    <td><span class="badge badge-active">ACTIVE</span></td>
                    <td>
                        <button class="btn secondary-btn" style="padding: 0.35rem 0.65rem; font-size: 0.78rem;" onclick="openPointsUpdateModal(${a.id}, '${escapeHtml(a.email)}', ${a.current_points})">
                            <i class="fa-solid fa-pen-to-square"></i> Update Points
                        </button>
                    </td>
                </tr>
            `).join('');
    }

    const bannedBody = document.getElementById('user-banned-accounts-body');
    if (bannedBody) {
        bannedBody.innerHTML = bannedList.length === 0 ? '<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">No banned accounts.</td></tr>' :
            bannedList.map(a => `
                <tr>
                    <td><strong>P${a.profile_no || '-'}</strong></td>
                    <td>${escapeHtml(a.email)}</td>
                    <td class="text-secondary">${a.server || '-'}</td>
                    <td>${a.current_points.toLocaleString()}</td>
                    <td><span class="badge badge-banned">BANNED</span></td>
                </tr>
            `).join('');
    }

    renderUserClassifiedAccounts('old');
}

function toggleUserClassTab(tab) {
    document.getElementById('btn-tab-user-old').className = tab === 'old' ? 'btn primary-btn' : 'btn secondary-btn';
    document.getElementById('btn-tab-user-new').className = tab === 'new' ? 'btn primary-btn' : 'btn secondary-btn';
    document.getElementById('user-class-table-title').textContent = tab === 'old' ? 'Old Accounts' : 'New Accounts';
    renderUserClassifiedAccounts(tab);
}

function renderUserClassifiedAccounts(tab) {
    const accounts = window._userAccounts || [];
    const list = accounts.filter(a => (a.classification || 'new') === tab);
    const body = document.getElementById('user-classified-accounts-body');
    if (!body) return;

    body.innerHTML = list.length === 0 ? `<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">No ${tab} accounts found.</td></tr>` :
        list.map(a => `
            <tr>
                <td><strong>P${a.profile_no || '-'}</strong></td>
                <td>${escapeHtml(a.email)}</td>
                <td>${a.current_points.toLocaleString()}</td>
                <td><span class="badge badge-primary">${tab.toUpperCase()}</span></td>
                <td><span class="badge ${a.status === 'active' ? 'badge-active' : 'badge-banned'}">${a.status.toUpperCase()}</span></td>
            </tr>
        `).join('');
}

// User Rewards
async function loadUserRewards() {
    try {
        const res = await fetch('/api/rewards', {
            headers: { 'Authorization': `Bearer ${currentToken}` }
        });
        if (!res.ok) return;
        const rewards = await res.json();

        const container = document.getElementById('user-rewards-container');
        if (!container) return;

        container.innerHTML = rewards.map(r => `
            <div class="reward-card">
                <div class="reward-card-header">
                    <div class="reward-name">${escapeHtml(r.user_display)}</div>
                </div>
                <div class="reward-cost">${r.points_required.toLocaleString()} points needed</div>
                <button class="btn secondary-btn" style="margin-top: 1rem; width: 100%;" onclick="openRequestRedemptionModal(${r.id}, '${escapeHtml(r.name)}')">
                    <i class="fa-solid fa-gift"></i> Request Redemption
                </button>
            </div>
        `).join('');

    } catch (e) {}
}

// User Request Center
async function loadUserRequests() {
    try {
        const res = await fetch('/api/requests', {
            headers: { 'Authorization': `Bearer ${currentToken}` }
        });
        if (!res.ok) return;
        const requests = await res.json();

        const body = document.getElementById('user-requests-table-body');
        if (!body) return;

        body.innerHTML = requests.length === 0 ? '<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">No requests submitted yet.</td></tr>' :
            requests.map(r => `
                <tr>
                    <td><strong>${escapeHtml(r.request_id)}</strong></td>
                    <td><span class="badge badge-primary">${r.category}</span></td>
                    <td>${escapeHtml(r.subject)}</td>
                    <td class="text-secondary">${new Date(r.created_at).toLocaleDateString()}</td>
                    <td><span class="badge ${r.status === 'Approved' ? 'badge-active' : (r.status === 'Pending' ? 'badge-pending' : 'badge-banned')}">${r.status}</span></td>
                    <td>${r.admin_response ? escapeHtml(r.admin_response) : '<span class="text-muted">Awaiting review</span>'}</td>
                </tr>
            `).join('');

    } catch (e) {}
}

function openCreateUserRequestModal() {
    openModal('modal-request-permission');
}

async function submitGeneralUserRequest() {
    const category = document.getElementById('req-category').value;
    const subject = document.getElementById('req-subject').value.trim();
    const message = document.getElementById('req-message').value.trim();

    if (!subject || !message) {
        showToast('Required', 'Please fill subject and message.', 'warning');
        return;
    }

    try {
        const res = await fetch('/api/requests', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentToken}` },
            body: JSON.stringify({ category, subject, message })
        });
        const data = await res.json();
        if (res.ok) {
            closeModal('modal-request-permission');
            showToast('Request Submitted', `Your request ${data.requestId} has been sent to the administrator.`);
            loadUserRequests();
        } else {
            showToast('Error', data.error || 'Failed to submit request', 'danger');
        }
    } catch (e) {
        showToast('Error', 'Submission failed', 'danger');
    }
}

// -----------------------------------------------------------------------------
// PERIODIC REVIEW FORM FULL-SCREEN GATE
// -----------------------------------------------------------------------------
function activateFormGate(pendingForm) {
    const overlay = document.getElementById('form-gate-overlay');
    const container = document.getElementById('periodic-questions-container');
    if (!overlay || !container) return;

    window._activeFormScheduleId = pendingForm.scheduleId;
    document.getElementById('gate-deadline-badge').textContent = `Deadline: ${pendingForm.deadlineDay}th of Month`;

    container.innerHTML = pendingForm.questions.map(q => `
        <div style="background: var(--bg-color); border: 1px solid var(--border-color); border-radius: 8px; padding: 1.25rem;">
            <div style="font-weight: 600; font-size: 0.92rem; margin-bottom: 0.75rem;">${q.id}. ${escapeHtml(q.text)}</div>
            ${q.type === 'yes_no' ? `
                <div style="display: flex; gap: 1.5rem; margin-bottom: 0.5rem;">
                    <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer;">
                        <input type="radio" name="pq_${q.id}" value="yes" required>
                        <span>Yes</span>
                    </label>
                    <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer;">
                        <input type="radio" name="pq_${q.id}" value="no" required>
                        <span>No</span>
                    </label>
                </div>
                ${q.details_placeholder ? `
                    <input type="text" name="pq_${q.id}_details" class="form-input" style="margin-top: 0.5rem;" placeholder="${escapeHtml(q.details_placeholder)}">
                ` : ''}
            ` : `
                <textarea name="pq_${q.id}" rows="2" class="form-input" placeholder="Type response..."></textarea>
            `}
        </div>
    `).join('');

    overlay.classList.remove('hidden');
}

function deactivateFormGate() {
    const overlay = document.getElementById('form-gate-overlay');
    if (overlay) overlay.classList.add('hidden');
}

async function submitMonthlyReviewForm(event) {
    event.preventDefault();
    const form = document.getElementById('periodic-review-form');
    const formData = new FormData(form);
    const answers = {};
    for (const [key, value] of formData.entries()) {
        answers[key] = value;
    }

    try {
        const res = await fetch('/api/forms/submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentToken}` },
            body: JSON.stringify({ scheduleId: window._activeFormScheduleId, answers })
        });
        const data = await res.json();
        if (res.ok) {
            deactivateFormGate();
            showToast('Form Submitted', 'Periodic review completed. Dashboard access unlocked!');
            loadUserOverview();
        } else {
            showToast('Error', data.error || 'Failed to submit review form', 'danger');
        }
    } catch (e) {
        showToast('Error', 'Submission failed', 'danger');
    }
}

// -----------------------------------------------------------------------------
// MODALS & GENERAL ACTIONS
// -----------------------------------------------------------------------------
function openModal(modalId) {
    const m = document.getElementById(modalId);
    if (m) m.classList.remove('hidden');
}
function closeModal(modalId) {
    const m = document.getElementById(modalId);
    if (m) m.classList.add('hidden');
}

function openContactAdminModal() {
    openModal('modal-contact-admin');
}

async function sendContactAdminMessage() {
    const subject = document.getElementById('contact-subject').value.trim();
    const message = document.getElementById('contact-message').value.trim();
    if (!subject || !message) {
        showToast('Required', 'Please fill subject and message', 'warning');
        return;
    }
    try {
        await fetch('/api/requests', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentToken}` },
            body: JSON.stringify({ category: 'contact_admin', subject, message })
        });
        closeModal('modal-contact-admin');
        showToast('Message Sent', 'Your message has been delivered to the administrator.');
    } catch (e) {
        showToast('Error', 'Failed to send message', 'danger');
    }
}

function openPointsUpdateModal(accId, email, currentPts) {
    document.getElementById('pu-account-id').value = accId;
    document.getElementById('pu-account-info').textContent = `Updating points for: ${email} (Current: ${currentPts} pts)`;
    document.getElementById('pu-points').value = currentPts;
    openModal('modal-points-update');
}

async function submitPointsUpdate() {
    const accId = document.getElementById('pu-account-id').value;
    const points = document.getElementById('pu-points').value;
    const reason = document.getElementById('pu-reason').value.trim();

    try {
        const res = await fetch(`/api/accounts/${accId}/points`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentToken}` },
            body: JSON.stringify({ points, reason })
        });
        const data = await res.json();
        if (res.ok) {
            closeModal('modal-points-update');
            showToast('Points Updated', `Account points updated to ${data.newPoints.toLocaleString()} pts.`);
            if (currentUser.role === 'admin') loadAllAccounts();
            else loadUserAccounts();
        } else {
            showToast('Denied', data.error || 'You do not have permission to update points. Submit a permission request.', 'danger');
        }
    } catch (e) {
        showToast('Error', 'Update failed', 'danger');
    }
}

function toggleTheme() {
    document.body.classList.toggle('light-theme');
}

// Run initial session check & load authentication configuration
loadAuthConfig();
checkSession();

window.addEventListener('load', () => {
    if (googleClientId) initializeGoogleGSI();
});
