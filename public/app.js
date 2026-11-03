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
    socket.on('review_form_sent', (pendingForm) => {
        if (currentUser && currentUser.role !== 'admin') {
            activateFormGate(pendingForm);
            showToast('Review Form Required', 'The administrator has requested you to complete your periodic review form to unlock your dashboard.', 'warning');
        }
    });
    socket.on('review_form_sent_all', (pendingForm) => {
        if (currentUser && currentUser.role !== 'admin') {
            activateFormGate(pendingForm);
            showToast('Review Form Required', 'The administrator has requested all operators to complete their periodic review form to unlock dashboard access.', 'warning');
        }
    });
    socket.on('review_form_cancelled', (data) => {
        if (currentUser && (currentUser.id == data.userId || currentUser.role !== 'admin')) {
            deactivateFormGate();
            showToast('Dashboard Resumed', 'The administrator cleared the review form requirement. Dashboard access resumed!', 'success');
            loadUserOverview();
        }
    });
    socket.on('review_form_unlocked', (data) => {
        if (currentUser && currentUser.id == data.userId) {
            deactivateFormGate();
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
let googleTokenClient = null;
let isGoogleGSIInitialized = false;

// Fetch backend authentication configuration (Google Client ID)
async function loadAuthConfig() {
    try {
        const res = await fetch('/api/auth/config');
        if (res.ok) {
            const data = await res.json();
            googleClientId = data.googleClientId || '';
            if (googleClientId) {
                initializeGoogleGSI();
            }
        }
    } catch (e) {
        console.warn('Failed to fetch auth configuration:', e);
    }
}

// Initialize Google Identity Services (GSI)
function initializeGoogleGSI() {
    if (!googleClientId) return;

    if (!window.google || !google.accounts) {
        // Retry when Google library script finishes loading
        setTimeout(initializeGoogleGSI, 400);
        return;
    }

    try {
        // 1. Initialize Google Identity Services for official Rendered Button
        if (google.accounts.id) {
            google.accounts.id.initialize({
                client_id: googleClientId,
                callback: handleGoogleCredentialResponse,
                auto_select: false,
                ux_mode: 'popup'
            });

            const renderTarget = document.getElementById('g-render-target');
            if (renderTarget && renderTarget.childElementCount === 0) {
                google.accounts.id.renderButton(renderTarget, {
                    theme: 'outline',
                    size: 'large',
                    width: 340,
                    text: 'continue_with',
                    shape: 'rectangular',
                    logo_alignment: 'center'
                });
            }
        }

        // 2. Initialize OAuth 2.0 Token Client (Opens immediate account popup on custom button click)
        if (google.accounts.oauth2) {
            googleTokenClient = google.accounts.oauth2.initTokenClient({
                client_id: googleClientId,
                scope: 'openid email profile',
                callback: async (tokenResponse) => {
                    if (tokenResponse.error) {
                        console.error('Google OAuth popup error:', tokenResponse);
                        showAuthError(`Google Sign-In failed: ${tokenResponse.error_description || tokenResponse.error}`);
                        return;
                    }
                    if (tokenResponse.access_token) {
                        await processGoogleLogin(tokenResponse.access_token);
                    }
                }
            });
        }

        isGoogleGSIInitialized = true;
    } catch (err) {
        console.error('Google Identity initialization error:', err);
    }
}

// Google OAuth Handler (Callback from Google Identity Services rendered button)
window.handleGoogleCredentialResponse = async function(response) {
    if (!response || !response.credential) {
        showAuthError('Invalid Google credential received.');
        return;
    }
    await processGoogleLogin(response.credential);
};

// Google OAuth Redirect & Callback Hash Handler
function handleGoogleAuthHash() {
    if (!window.location.hash) return;
    const hash = window.location.hash.substring(1);
    if (!hash.includes('id_token') && !hash.includes('access_token') && !hash.includes('error')) return;

    const params = new URLSearchParams(hash);
    const idToken = params.get('id_token');
    const accessToken = params.get('access_token');
    const error = params.get('error');

    if (error) {
        showAuthError(`Google authentication error: ${error}`);
        window.history.replaceState(null, '', window.location.pathname);
        return;
    }

    if (idToken || accessToken) {
        window.history.replaceState(null, '', window.location.pathname);
        showToast('Authenticating', 'Verifying Google credentials with PointPulse...');
        processGoogleLogin(idToken || accessToken);
    }
}

// Initiate Google Login (OAuth 2.0 Direct Popup & Universal Redirect Fallback)
function initiateGoogleLogin() {
    if (!googleClientId) {
        openModal('modal-auth-setup');
        return;
    }

    const redirectUri = window.location.origin;
    const nonce = Math.random().toString(36).substring(2) + Date.now();
    const oauthUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
        `client_id=${encodeURIComponent(googleClientId)}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&response_type=token%20id_token` +
        `&scope=${encodeURIComponent('openid email profile')}` +
        `&nonce=${nonce}` +
        `&prompt=select_account`;

    const btn = document.getElementById('custom-google-btn');
    const originalContent = btn ? btn.innerHTML : '';
    if (btn) {
        btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> <span>Connecting to Google...</span>`;
        btn.disabled = true;
    }

    // Attempt popup window first
    const width = 500;
    const height = 620;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;

    let popup = null;
    try {
        popup = window.open(
            oauthUrl,
            'google_oauth_popup',
            `width=${width},height=${height},left=${left},top=${top},status=no,toolbar=no,menubar=no`
        );
    } catch (e) {
        popup = null;
    }

    // If popup was blocked by browser or failed, fallback to full page redirect!
    if (!popup || popup.closed || typeof popup.closed === 'undefined') {
        window.location.href = oauthUrl;
        return;
    }

    // Monitor popup for redirect with credentials
    const checkTimer = setInterval(() => {
        try {
            if (!popup || popup.closed) {
                clearInterval(checkTimer);
                if (btn) {
                    btn.innerHTML = originalContent;
                    btn.disabled = false;
                }
                return;
            }
            if (popup.location && popup.location.origin === window.location.origin) {
                const popupHash = popup.location.hash;
                if (popupHash) {
                    clearInterval(checkTimer);
                    popup.close();
                    if (btn) {
                        btn.innerHTML = originalContent;
                        btn.disabled = false;
                    }
                    window.location.hash = popupHash;
                    handleGoogleAuthHash();
                }
            }
        } catch (e) {
            // Cross-origin restriction while user is on accounts.google.com - expected until redirect
        }
    }, 250);
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

// Direct Email + Password Auth Handlers & Tab Switching
function switchAuthTab(tab) {
    const tabSignIn = document.getElementById('tab-auth-signin');
    const tabRegister = document.getElementById('tab-auth-register');
    const formLogin = document.getElementById('auth-login-form');
    const formRegister = document.getElementById('auth-register-form');
    const errorBanner = document.getElementById('auth-error-banner');
    if (errorBanner) errorBanner.classList.add('hidden');

    if (tab === 'signin') {
        tabSignIn?.classList.add('active');
        tabRegister?.classList.remove('active');
        formLogin?.classList.remove('hidden');
        formRegister?.classList.add('hidden');
    } else {
        tabSignIn?.classList.remove('active');
        tabRegister?.classList.add('active');
        formLogin?.classList.add('hidden');
        formRegister?.classList.remove('hidden');
    }
}

async function handleEmailPasswordLogin(event) {
    event.preventDefault();
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const btn = document.getElementById('btn-login-submit');
    const errorBanner = document.getElementById('auth-error-banner');
    if (errorBanner) errorBanner.classList.add('hidden');

    if (!email || !password) {
        showAuthError('Please enter both email and password.');
        return;
    }

    const origHtml = btn ? btn.innerHTML : '';
    if (btn) {
        btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Signing in...`;
        btn.disabled = true;
    }

    try {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });

        const data = await res.json();

        if (!res.ok) {
            showAuthError(data.error || 'Authentication failed. Please check your credentials.');
            if (btn) { btn.innerHTML = origHtml; btn.disabled = false; }
            return;
        }

        currentToken = data.token;
        localStorage.setItem('pointpulse_token', currentToken);
        currentUser = data.user;

        if (currentUser.role === 'admin') {
            setupAdminDashboard();
            showToast('Welcome, Administrator', `Signed in as ${currentUser.email}`);
        } else if (data.status === 'pending' || currentUser.status === 'pending') {
            showPendingScreen(currentUser);
        } else if (currentUser.status === 'approved') {
            setupUserDashboard();
            showToast('Welcome Back', `Signed in as ${currentUser.name}`);
        } else {
            showView('auth');
        }
    } catch (err) {
        console.error('Login error:', err);
        showAuthError('Unable to connect to authentication server.');
    } finally {
        if (btn) { btn.innerHTML = origHtml; btn.disabled = false; }
    }
}

async function handleDirectUserRegister(event) {
    event.preventDefault();
    const name = document.getElementById('reg-direct-name').value.trim();
    const email = document.getElementById('reg-direct-email').value.trim().toLowerCase();
    const password = document.getElementById('reg-direct-password').value;
    const confirm = document.getElementById('reg-direct-confirm').value;
    const phone = document.getElementById('reg-direct-phone').value.trim();
    const purpose = document.getElementById('reg-direct-purpose').value;
    const description = document.getElementById('reg-direct-description').value.trim();
    const terms = document.getElementById('reg-direct-terms').checked;
    const btn = document.getElementById('btn-register-submit');
    const errorBanner = document.getElementById('auth-error-banner');
    if (errorBanner) errorBanner.classList.add('hidden');

    if (!terms) {
        showAuthError('You must acknowledge the mandatory terms to proceed.');
        return;
    }

    if (password !== confirm) {
        showAuthError('Passwords do not match. Please re-enter your password.');
        return;
    }

    if (password.length < 6) {
        showAuthError('Password must be at least 6 characters.');
        return;
    }

    const origHtml = btn ? btn.innerHTML : '';
    if (btn) {
        btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Submitting application...`;
        btn.disabled = true;
    }

    try {
        const res = await fetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name,
                displayName: name,
                email,
                password,
                phone,
                registrationPurpose: purpose,
                accountManagementDescription: description,
                termsAccepted: true
            })
        });

        const data = await res.json();

        if (!res.ok) {
            showAuthError(data.error || 'Registration failed.');
            if (btn) { btn.innerHTML = origHtml; btn.disabled = false; }
            return;
        }

        currentToken = data.token;
        localStorage.setItem('pointpulse_token', currentToken);
        currentUser = data.user;

        showPendingScreen(currentUser);
        showToast('Application Submitted', 'Your registration is awaiting administrator approval.');
    } catch (err) {
        console.error('Registration error:', err);
        showAuthError('Unable to submit registration application.');
    } finally {
        if (btn) { btn.innerHTML = origHtml; btn.disabled = false; }
    }
}

function formatProfileNo(val) {
    if (val === null || val === undefined || val === '') return '-';
    const num = parseInt(val, 10);
    if (!isNaN(num)) {
        return String(num).padStart(3, '0');
    }
    return String(val);
}

function copyCredText(elementId) {
    const el = document.getElementById(elementId);
    if (!el) return;
    const val = el.getAttribute('data-real-value') || el.textContent;
    if (!val || val === '-' || val === 'None') {
        showToast('Info', 'No value to copy', 'warning');
        return;
    }
    navigator.clipboard.writeText(val).then(() => {
        showToast('Copied', `Copied to clipboard: ${val}`);
    }).catch(() => {
        showToast('Error', 'Failed to copy to clipboard', 'danger');
    });
}

function toggleCredVisibility(elementId) {
    const el = document.getElementById(elementId);
    if (!el) return;
    const isMasked = el.getAttribute('data-masked') === 'true';
    const realVal = el.getAttribute('data-real-value') || '';
    if (!realVal || realVal === 'None' || realVal === '-') return;

    if (isMasked) {
        el.textContent = realVal;
        el.setAttribute('data-masked', 'false');
    } else {
        el.textContent = '••••••••';
        el.setAttribute('data-masked', 'true');
    }
}

function downloadExcelTemplate() {
    const csvContent = "profile_no,email,email_password,server,proton_email,proton_password,alternative_email,alternative_password,current_points,classification,status,notes\n001,user.acc1@gmail.com,Pass123!,US-AZ#146,proton1@proton.me,ProtPass1!,recovery1@gmail.com,AltPass1!,5000,old,active,Primary production profile\n002,user.acc2@gmail.com,Pass456!,US-DC#257,proton2@proton.me,ProtPass2!,,,7350,new,active,Secondary backup profile\n003,charlieacc@outlook.com,OutPass789!,US-TX#450,charlie@proton.me,ProtPass3!,charlie_alt@yahoo.com,AltPass3!,1200,new,banned,Routine audit record\n";
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', 'pointpulse_accounts_template.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('Template Downloaded', 'Sample CSV template downloaded with 3-digit profile numbers and credentials.');
}

window.formatProfileNo = formatProfileNo;
window.copyCredText = copyCredText;
window.toggleCredVisibility = toggleCredVisibility;

window.switchAuthTab = switchAuthTab;
window.handleEmailPasswordLogin = handleEmailPasswordLogin;
window.handleDirectUserRegister = handleDirectUserRegister;
window.downloadExcelTemplate = downloadExcelTemplate;

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
    if (pageId === 'admin-points-perms') loadAdminPointsPerms();
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
                    <td>
                        <span class="badge ${statusClass}">${u.status.toUpperCase()}</span>
                        ${u.reviewFormRequired ? `<div style="margin-top: 4px;"><span class="badge badge-pending" style="font-size: 0.68rem;"><i class="fa-solid fa-lock"></i> Review Sent</span></div>` : ''}
                    </td>
                    <td><strong>${u.activeAccountsCount}</strong> active</td>
                    <td class="text-danger">${u.bannedAccountsCount} banned</td>
                    <td style="color: var(--secondary-color); font-weight: 700;">${u.totalPoints.toLocaleString()} pts</td>
                    <td>
                        <div style="display: flex; gap: 0.4rem; flex-wrap: wrap;">
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
                                ${u.reviewFormRequired ? `
                                    <button class="btn secondary-btn" style="padding: 0.35rem 0.55rem; font-size: 0.78rem;" onclick="adminCancelReviewForm(${u.id})" title="Cancel review form requirement and resume operator dashboard">
                                        <i class="fa-solid fa-unlock"></i> Unlock Form
                                    </button>
                                ` : `
                                    <button class="btn warning-btn" style="padding: 0.35rem 0.55rem; font-size: 0.78rem;" onclick="adminSendReviewForm(${u.id}, '${escapeHtml(u.name)}')" title="Send review form to operator to finish (dashboard blocked until submitted)">
                                        <i class="fa-solid fa-paper-plane"></i> Send Form
                                    </button>
                                `}
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

async function adminAssignAllToCurrentDossierUser() {
    if (!activeUserDetailId) return;
    const data = window._activeUserDetails;
    const userName = data?.user?.name || `User #${activeUserDetailId}`;
    const userEmail = data?.user?.email || '';

    if (!confirm(`Are you sure you want to assign ALL platform accounts in the database to ${userName} (${userEmail})?`)) return;

    try {
        const res = await fetch(`/api/admin/users/${activeUserDetailId}/claim-all-accounts`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${currentToken}` }
        });
        const resData = await res.json();
        if (res.ok) {
            showToast('Accounts Assigned', resData.message);
            openUserDetails(activeUserDetailId);
        } else {
            showToast('Error', resData.error || 'Failed to assign accounts', 'danger');
        }
    } catch (e) {
        showToast('Error', 'Network error', 'danger');
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
        const userPermKeys = data.permissions.map(p => p.permission_key);
        const hasPoints = userPermKeys.includes('update_points');
        const hasEdit = userPermKeys.includes('edit_accounts');
        const hasAdd = userPermKeys.includes('add_accounts');
        const hasImport = userPermKeys.includes('import_excel');

        const now = new Date();
        const activeWin = data.tempWindows?.find(w => w.is_active && new Date(w.start_time) <= now && new Date(w.end_time) >= now);
        const isReadOnly = !hasPoints && !hasEdit && !hasAdd && !activeWin;

        container.innerHTML = `
            <div class="kpi-grid">
                <div class="kpi-card"><div class="kpi-title">Managed Accounts</div><div class="kpi-value">${data.accounts.length}</div></div>
                <div class="kpi-card kpi-success"><div class="kpi-title">Active Accounts</div><div class="kpi-value">${data.accounts.filter(a => a.status === 'active').length}</div></div>
                <div class="kpi-card kpi-warning"><div class="kpi-title">Confirmed Redemptions</div><div class="kpi-value">${data.redemptions.length}</div></div>
                <div class="kpi-card kpi-secondary"><div class="kpi-title">Active Permissions</div><div class="kpi-value">${data.permissions.length}</div></div>
            </div>

            <!-- QUICK ACCESS MODE & TOGGLES CARD -->
            <div class="table-card" style="padding: 1.5rem; margin-bottom: 1.5rem;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; border-bottom: 1px solid var(--border-color); padding-bottom: 0.75rem; flex-wrap: wrap; gap: 0.5rem;">
                    <div>
                        <h4 style="font-weight: 700; color: var(--secondary-color);"><i class="fa-solid fa-sliders"></i> Access Mode & Quick Feature Toggles</h4>
                        <p class="text-secondary" style="font-size: 0.82rem;">1-Click switch between Read-Only 🔒 and Write ✏️ modes for this operator.</p>
                    </div>
                    <div>
                        ${activeWin ? `
                            <span class="badge badge-active">🟢 Temporary Window Active (${Math.round((new Date(activeWin.end_time) - now) / 60000)}m remaining)</span>
                        ` : (isReadOnly ? `
                            <span class="badge badge-pending">🔒 Read-Only Mode (Locked)</span>
                        ` : `
                            <span class="badge badge-active">✏️ Write Access Enabled</span>
                        `)}
                    </div>
                </div>

                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 0.75rem; margin-bottom: 1rem;">
                    <!-- TOGGLE 1: POINTS UPDATING -->
                    <div style="background: rgba(15, 23, 42, 0.4); padding: 0.75rem; border-radius: 8px; border: 1px solid var(--border-color);">
                        <div style="font-size: 0.75rem; font-weight: 600; color: var(--text-secondary); margin-bottom: 0.35rem;">Points Updating</div>
                        <button class="btn ${hasPoints ? 'primary-btn' : 'secondary-btn'}" 
                                style="width: 100%; font-size: 0.78rem; padding: 0.35rem 0.6rem; justify-content: center; ${hasPoints ? 'background: #10b981; border-color: #10b981; color: #fff;' : 'background: rgba(100, 116, 139, 0.2); color: #94a3b8;'}"
                                onclick="quickToggleUserPerm(${data.user.id}, 'update_points', ${!hasPoints})">
                            <i class="fa-solid fa-${hasPoints ? 'check' : 'lock'}"></i> ${hasPoints ? 'Write Allowed ✏️' : 'Read-Only 🔒'}
                        </button>
                    </div>

                    <!-- TOGGLE 2: ACCOUNT EDITING -->
                    <div style="background: rgba(15, 23, 42, 0.4); padding: 0.75rem; border-radius: 8px; border: 1px solid var(--border-color);">
                        <div style="font-size: 0.75rem; font-weight: 600; color: var(--text-secondary); margin-bottom: 0.35rem;">Account Info Editing</div>
                        <button class="btn ${hasEdit ? 'primary-btn' : 'secondary-btn'}" 
                                style="width: 100%; font-size: 0.78rem; padding: 0.35rem 0.6rem; justify-content: center; ${hasEdit ? 'background: #10b981; border-color: #10b981; color: #fff;' : 'background: rgba(100, 116, 139, 0.2); color: #94a3b8;'}"
                                onclick="quickToggleUserPerm(${data.user.id}, 'edit_accounts', ${!hasEdit})">
                            <i class="fa-solid fa-${hasEdit ? 'check' : 'lock'}"></i> ${hasEdit ? 'Write Allowed ✏️' : 'Read-Only 🔒'}
                        </button>
                    </div>

                    <!-- TOGGLE 3: ADD ACCOUNTS -->
                    <div style="background: rgba(15, 23, 42, 0.4); padding: 0.75rem; border-radius: 8px; border: 1px solid var(--border-color);">
                        <div style="font-size: 0.75rem; font-weight: 600; color: var(--text-secondary); margin-bottom: 0.35rem;">Add Accounts</div>
                        <button class="btn ${hasAdd ? 'primary-btn' : 'secondary-btn'}" 
                                style="width: 100%; font-size: 0.78rem; padding: 0.35rem 0.6rem; justify-content: center; ${hasAdd ? 'background: #10b981; border-color: #10b981; color: #fff;' : 'background: rgba(100, 116, 139, 0.2); color: #94a3b8;'}"
                                onclick="quickToggleUserPerm(${data.user.id}, 'add_accounts', ${!hasAdd})">
                            <i class="fa-solid fa-${hasAdd ? 'plus' : 'ban'}"></i> ${hasAdd ? 'Allowed ➕' : 'Blocked 🔒'}
                        </button>
                    </div>

                    <!-- TOGGLE 4: IMPORT EXCEL -->
                    <div style="background: rgba(15, 23, 42, 0.4); padding: 0.75rem; border-radius: 8px; border: 1px solid var(--border-color);">
                        <div style="font-size: 0.75rem; font-weight: 600; color: var(--text-secondary); margin-bottom: 0.35rem;">Excel Upload</div>
                        <button class="btn ${hasImport ? 'primary-btn' : 'secondary-btn'}" 
                                style="width: 100%; font-size: 0.78rem; padding: 0.35rem 0.6rem; justify-content: center; ${hasImport ? 'background: #10b981; border-color: #10b981; color: #fff;' : 'background: rgba(100, 116, 139, 0.2); color: #94a3b8;'}"
                                onclick="quickToggleUserPerm(${data.user.id}, 'import_excel', ${!hasImport})">
                            <i class="fa-solid fa-${hasImport ? 'file-excel' : 'ban'}"></i> ${hasImport ? 'Allowed 📥' : 'Blocked 🔒'}
                        </button>
                    </div>
                </div>

                <div style="display: flex; gap: 0.5rem; justify-content: flex-end;">
                    <button class="btn primary-btn" style="font-size: 0.78rem; padding: 0.4rem 0.8rem;" onclick="switchUserTab('permissions')">
                        <i class="fa-solid fa-clock"></i> Schedule Access Window
                    </button>
                    <button class="btn danger-btn" style="font-size: 0.78rem; padding: 0.4rem 0.8rem;" onclick="revokeDossierUserWindow(${data.user.id})">
                        <i class="fa-solid fa-lock"></i> Lock to Read-Only
                    </button>
                </div>
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
                            <tr><th>Prof #</th><th>Email</th><th>Server</th><th>Classification</th><th>Status</th><th>Actions</th></tr>
                        </thead>
                        <tbody>
                            ${filtered.length === 0 ? '<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">No accounts in this category.</td></tr>' : 
                            filtered.map(a => `
                                <tr>
                                    <td><strong>${formatProfileNo(a.profile_no)}</strong></td>
                                    <td>${escapeHtml(a.email)}</td>
                                    <td class="text-secondary">${a.server || '-'}</td>
                                    <td><span class="badge badge-primary">${(a.classification || 'new').toUpperCase()}</span></td>
                                    <td><span class="badge ${a.status === 'active' ? 'badge-active' : 'badge-banned'}">${a.status.toUpperCase()}</span></td>
                                    <td>
                                        <button class="btn secondary-btn" style="padding: 0.25rem 0.55rem; font-size: 0.75rem;" onclick="openAccountDetailsPage(${a.id})">
                                            <i class="fa-solid fa-circle-info"></i> Details
                                        </button>
                                    </td>
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
        const hasPoints = userPermKeys.includes('update_points');
        const hasEdit = userPermKeys.includes('edit_accounts');
        const hasAdd = userPermKeys.includes('add_accounts');
        const hasImport = userPermKeys.includes('import_excel');

        const now = new Date();
        const activeWin = data.tempWindows?.find(w => w.is_active && new Date(w.start_time) <= now && new Date(w.end_time) >= now);

        container.innerHTML = `
            <!-- CARD 1: 1-CLICK FEATURE TOGGLES -->
            <div class="table-card" style="padding: 1.5rem; margin-bottom: 1.5rem;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; border-bottom: 1px solid var(--border-color); padding-bottom: 0.75rem;">
                    <div>
                        <h4 style="font-weight: 700; color: var(--secondary-color);"><i class="fa-solid fa-toggle-on"></i> Quick Feature Toggles (1-Click Read-Only vs. Write)</h4>
                        <p class="text-secondary" style="font-size: 0.82rem;">Changes take effect immediately without needing to click save.</p>
                    </div>
                    <span class="badge ${activeWin ? 'badge-active' : (hasPoints || hasEdit ? 'badge-active' : 'badge-pending')}">
                        ${activeWin ? '🟢 Window Active' : (hasPoints || hasEdit ? '✏️ Write Enabled' : '🔒 Read-Only')}
                    </span>
                </div>

                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 0.75rem;">
                    <div style="background: rgba(15, 23, 42, 0.4); padding: 0.75rem; border-radius: 8px; border: 1px solid var(--border-color);">
                        <div style="font-size: 0.75rem; font-weight: 600; color: var(--text-secondary); margin-bottom: 0.35rem;">Points Updating</div>
                        <button class="btn ${hasPoints ? 'primary-btn' : 'secondary-btn'}" 
                                style="width: 100%; font-size: 0.78rem; padding: 0.35rem 0.6rem; justify-content: center; ${hasPoints ? 'background: #10b981; border-color: #10b981; color: #fff;' : 'background: rgba(100, 116, 139, 0.2); color: #94a3b8;'}"
                                onclick="quickToggleUserPerm(${data.user.id}, 'update_points', ${!hasPoints})">
                            <i class="fa-solid fa-${hasPoints ? 'check' : 'lock'}"></i> ${hasPoints ? 'Write Allowed ✏️' : 'Read-Only 🔒'}
                        </button>
                    </div>
                    <div style="background: rgba(15, 23, 42, 0.4); padding: 0.75rem; border-radius: 8px; border: 1px solid var(--border-color);">
                        <div style="font-size: 0.75rem; font-weight: 600; color: var(--text-secondary); margin-bottom: 0.35rem;">Account Info Editing</div>
                        <button class="btn ${hasEdit ? 'primary-btn' : 'secondary-btn'}" 
                                style="width: 100%; font-size: 0.78rem; padding: 0.35rem 0.6rem; justify-content: center; ${hasEdit ? 'background: #10b981; border-color: #10b981; color: #fff;' : 'background: rgba(100, 116, 139, 0.2); color: #94a3b8;'}"
                                onclick="quickToggleUserPerm(${data.user.id}, 'edit_accounts', ${!hasEdit})">
                            <i class="fa-solid fa-${hasEdit ? 'check' : 'lock'}"></i> ${hasEdit ? 'Write Allowed ✏️' : 'Read-Only 🔒'}
                        </button>
                    </div>
                    <div style="background: rgba(15, 23, 42, 0.4); padding: 0.75rem; border-radius: 8px; border: 1px solid var(--border-color);">
                        <div style="font-size: 0.75rem; font-weight: 600; color: var(--text-secondary); margin-bottom: 0.35rem;">Add Accounts</div>
                        <button class="btn ${hasAdd ? 'primary-btn' : 'secondary-btn'}" 
                                style="width: 100%; font-size: 0.78rem; padding: 0.35rem 0.6rem; justify-content: center; ${hasAdd ? 'background: #10b981; border-color: #10b981; color: #fff;' : 'background: rgba(100, 116, 139, 0.2); color: #94a3b8;'}"
                                onclick="quickToggleUserPerm(${data.user.id}, 'add_accounts', ${!hasAdd})">
                            <i class="fa-solid fa-${hasAdd ? 'plus' : 'ban'}"></i> ${hasAdd ? 'Allowed ➕' : 'Blocked 🔒'}
                        </button>
                    </div>
                    <div style="background: rgba(15, 23, 42, 0.4); padding: 0.75rem; border-radius: 8px; border: 1px solid var(--border-color);">
                        <div style="font-size: 0.75rem; font-weight: 600; color: var(--text-secondary); margin-bottom: 0.35rem;">Excel Upload</div>
                        <button class="btn ${hasImport ? 'primary-btn' : 'secondary-btn'}" 
                                style="width: 100%; font-size: 0.78rem; padding: 0.35rem 0.6rem; justify-content: center; ${hasImport ? 'background: #10b981; border-color: #10b981; color: #fff;' : 'background: rgba(100, 116, 139, 0.2); color: #94a3b8;'}"
                                onclick="quickToggleUserPerm(${data.user.id}, 'import_excel', ${!hasImport})">
                            <i class="fa-solid fa-${hasImport ? 'file-excel' : 'ban'}"></i> ${hasImport ? 'Allowed 📥' : 'Blocked 🔒'}
                        </button>
                    </div>
                </div>
            </div>

            <!-- CARD 2: QUICK ACCESS WINDOW SCHEDULER -->
            <div class="table-card" style="padding: 1.5rem; margin-bottom: 1.5rem;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; border-bottom: 1px solid var(--border-color); padding-bottom: 0.75rem;">
                    <div>
                        <h4 style="font-weight: 700; color: var(--primary-color);"><i class="fa-solid fa-clock"></i> Schedule Temporary Access Window</h4>
                        <p class="text-secondary" style="font-size: 0.82rem;">Grant temporary write access for a specific duration.</p>
                    </div>
                    ${activeWin ? `<button class="btn danger-btn" style="font-size: 0.78rem;" onclick="revokeDossierUserWindow(${data.user.id})"><i class="fa-solid fa-lock"></i> Revoke Window Now</button>` : ''}
                </div>

                <div style="display: flex; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 0.5rem;">
                    <button class="btn secondary-btn" style="font-size: 0.8rem;" onclick="scheduleDossierWindow(${data.user.id}, 30)">⏱️ 30 Mins</button>
                    <button class="btn primary-btn" style="font-size: 0.8rem;" onclick="scheduleDossierWindow(${data.user.id}, 60)">⏱️ 1 Hour</button>
                    <button class="btn secondary-btn" style="font-size: 0.8rem;" onclick="scheduleDossierWindow(${data.user.id}, 120)">⏱️ 2 Hours</button>
                    <button class="btn secondary-btn" style="font-size: 0.8rem;" onclick="scheduleDossierWindow(${data.user.id}, 1440)">⏱️ 24 Hours</button>
                </div>
            </div>

            <!-- CARD 3: GRANULAR PERMISSIONS -->
            <div class="table-card" style="padding: 1.5rem;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
                    <div>
                        <h4 style="font-weight: 700;">Granular Permissions</h4>
                        <p class="text-secondary" style="font-size: 0.85rem;">Enforce strict backend authorization for every action.</p>
                    </div>
                    <button class="btn secondary-btn" onclick="openTempWindowModal(${data.user.id}, '${escapeHtml(data.user.name)}')">
                        <i class="fa-solid fa-clock"></i> Custom ISO Window
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
    } else if (tabName === 'requests') {
        const requests = data.requests || [];
        container.innerHTML = `
            <div class="table-card" style="padding: 1.5rem;">
                <h4 style="font-weight: 700; margin-bottom: 1rem;"><i class="fa-solid fa-paper-plane"></i> User Requests & Access Tickets (${requests.length})</h4>
                <div style="display: flex; flex-direction: column; gap: 0.75rem;">
                    ${requests.length === 0 ? '<div style="text-align: center; color: var(--text-muted); padding: 2rem;">No requests submitted by this user yet.</div>' :
                    requests.map(r => `
                        <div style="background: var(--bg-color); border: 1px solid var(--border-color); border-radius: 8px; padding: 1rem; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem;">
                            <div>
                                <div style="display: flex; gap: 0.5rem; align-items: center; margin-bottom: 0.35rem;">
                                    <span class="badge badge-primary">${r.request_id}</span>
                                    <span class="badge ${r.status === 'Approved' ? 'badge-active' : (r.status === 'Pending' ? 'badge-pending' : 'badge-banned')}">${r.status.toUpperCase()}</span>
                                    <strong style="color: #fff; font-size: 0.9rem;">${escapeHtml(r.subject)}</strong>
                                </div>
                                <div class="text-secondary" style="font-size: 0.85rem; margin-bottom: 0.35rem;">${escapeHtml(r.message)}</div>
                                <div class="text-muted" style="font-size: 0.76rem;">Submitted on ${new Date(r.created_at).toLocaleString()}</div>
                            </div>
                            ${r.status === 'Pending' ? `
                                <div style="display: flex; gap: 0.4rem; flex-wrap: wrap;">
                                    <button class="btn primary-btn" style="font-size: 0.76rem; padding: 0.35rem 0.65rem;" onclick="approveRequestWithWindow('${r.request_id}', 120)">
                                        <i class="fa-solid fa-bolt"></i> Approve 2h Window
                                    </button>
                                    <button class="btn secondary-btn" style="font-size: 0.76rem; padding: 0.35rem 0.65rem;" onclick="approveRequestWithWindow('${r.request_id}', 1440)">
                                        Approve 24h
                                    </button>
                                    <button class="btn danger-btn" style="font-size: 0.76rem; padding: 0.35rem 0.65rem;" onclick="rejectAccessRequest('${r.request_id}')">
                                        Reject
                                    </button>
                                </div>
                            ` : ''}
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    } else if (tabName === 'points') {
        const pointsList = data.points || [];
        container.innerHTML = `
            <div class="table-card" style="padding: 1.5rem;">
                <h4 style="font-weight: 700; margin-bottom: 1rem;"><i class="fa-solid fa-coins"></i> Points Overview (${pointsList.length} updates recorded)</h4>
                <div class="table-responsive" style="max-height: 500px;">
                    <table class="modern-table">
                        <thead>
                            <tr><th>Account ID</th><th>Points</th><th>Date / Reason</th><th>Recorded At</th></tr>
                        </thead>
                        <tbody>
                            ${pointsList.length === 0 ? '<tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">No points records found.</td></tr>' :
                            pointsList.slice(0, 50).map(p => `
                                <tr>
                                    <td>Account #${p.user_id}</td>
                                    <td style="color: var(--secondary-color); font-weight: 700;">${Number(p.points).toLocaleString()}</td>
                                    <td class="text-secondary">${escapeHtml(p.date || '-')}</td>
                                    <td class="text-muted" style="font-size: 0.8rem;">${p.updated_at ? new Date(p.updated_at).toLocaleString() : '-'}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    } else if (tabName === 'redemption') {
        const redList = data.redemptions || [];
        container.innerHTML = `
            <div class="table-card" style="padding: 1.5rem;">
                <h4 style="font-weight: 700; margin-bottom: 1rem;"><i class="fa-solid fa-gift"></i> Confirmed Redemptions (${redList.length})</h4>
                <div class="table-responsive" style="max-height: 500px;">
                    <table class="modern-table">
                        <thead>
                            <tr><th>Account ID</th><th>Reward Item</th><th>Points Spent</th><th>Redeemed At</th></tr>
                        </thead>
                        <tbody>
                            ${redList.length === 0 ? '<tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">No redemptions recorded for this user.</td></tr>' :
                            redList.map(r => `
                                <tr>
                                    <td>Account #${r.user_id}</td>
                                    <td><strong>${escapeHtml(r.reward_name || 'Reward')}</strong></td>
                                    <td style="color: var(--warning-color); font-weight: 600;">${Number(r.points_spent || 0).toLocaleString()} pts</td>
                                    <td class="text-muted" style="font-size: 0.8rem;">${r.redeemed_at ? new Date(r.redeemed_at).toLocaleString() : '-'}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
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

async function scheduleDossierWindow(userId, minutes) {
    try {
        const res = await fetch(`/api/admin/users/${userId}/schedule-window`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentToken}` },
            body: JSON.stringify({ durationMinutes: minutes, permittedActions: ['update_points', 'edit_accounts', 'add_accounts', 'import_excel'] })
        });
        if (res.ok) {
            showToast('Window Granted', `Granted ${Math.round(minutes / 60)} hour temporary access window.`);
            openUserDetails(userId);
        } else {
            showToast('Error', 'Failed to schedule window', 'danger');
        }
    } catch (e) {
        showToast('Error', 'Schedule failed', 'danger');
    }
}

async function revokeDossierUserWindow(userId) {
    if (!confirm('Immediately revoke write access and lock user to Read-Only mode?')) return;
    try {
        const res = await fetch(`/api/admin/users/${userId}/revoke-window`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${currentToken}` }
        });
        if (res.ok) {
            showToast('Access Locked', 'User returned to Read-Only mode.');
            openUserDetails(userId);
        }
    } catch (e) {
        showToast('Error', 'Revoke failed', 'danger');
    }
}

// 3. Admin All Accounts & Detailed Account Governance
async function loadAllAccounts() {
    try {
        const [accRes, usersRes] = await Promise.all([
            fetch('/api/accounts', { headers: { 'Authorization': `Bearer ${currentToken}` } }),
            fetch('/api/admin/users', { headers: { 'Authorization': `Bearer ${currentToken}` } })
        ]);
        if (!accRes.ok) return;
        const accounts = await accRes.json();
        window._allAccounts = accounts;

        if (usersRes.ok) {
            const users = await usersRes.json();
            window._allPlatformUsers = users;
            populateAdminOwnerFilter(users);
        }

        filterAllAccountsTable();
    } catch (e) {
        console.error('Failed to load all accounts:', e);
    }
}

function populateAdminOwnerFilter(users) {
    const filter = document.getElementById('all-acc-owner-filter');
    if (!filter) return;
    const currentVal = filter.value;
    filter.innerHTML = `<option value="all">All Operators / Owners</option>` +
        users.map(u => `<option value="${u.id}">${escapeHtml(u.displayName || u.name || u.email)} (${escapeHtml(u.email)})</option>`).join('');
    if (currentVal) filter.value = currentVal;
}

function filterAllAccountsTable() {
    const accounts = window._allAccounts || [];
    const search = document.getElementById('all-acc-search')?.value.toLowerCase() || '';
    const statusFilter = document.getElementById('all-acc-status-filter')?.value || 'all';
    const classFilter = document.getElementById('all-acc-class-filter')?.value || 'all';
    const ownerFilter = document.getElementById('all-acc-owner-filter')?.value || 'all';

    const filtered = accounts.filter(a => {
        const matchSearch = a.email.toLowerCase().includes(search) || (a.profile_no && String(a.profile_no).includes(search));
        const matchStatus = statusFilter === 'all' || a.status === statusFilter;
        const matchClass = classFilter === 'all' || a.classification === classFilter;
        const matchOwner = ownerFilter === 'all' || String(a.user_id) === ownerFilter;
        return matchSearch && matchStatus && matchClass && matchOwner;
    });

    const body = document.getElementById('all-accounts-table-body');
    if (!body) return;

    if (filtered.length === 0) {
        body.innerHTML = '<tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 2rem;">No accounts found matching criteria.</td></tr>';
        return;
    }

    body.innerHTML = filtered.map(a => `
        <tr>
            <td><strong>${formatProfileNo(a.profile_no)}</strong></td>
            <td>
                <div style="font-weight: 600; color: #fff;">${escapeHtml(a.email)}</div>
                ${a.recovery_email ? `<div class="text-secondary" style="font-size: 0.78rem;">Alt: ${escapeHtml(a.recovery_email)}</div>` : ''}
            </td>
            <td>
                <span class="badge" style="background: rgba(99, 102, 241, 0.15); color: #c7d2fe; border: 1px solid rgba(99, 102, 241, 0.3); font-size: 0.76rem; display: inline-flex; align-items: center; gap: 0.35rem;">
                    <i class="fa-solid fa-user${a.owner_role === 'admin' ? '-shield' : ''}"></i> ${escapeHtml(a.owner_name || 'Administrator')}
                </span>
                <div class="text-secondary" style="font-size: 0.72rem; margin-top: 3px;">${escapeHtml(a.owner_email || '')}</div>
            </td>
            <td class="text-secondary">${a.server || '-'}</td>
            <td style="color: var(--secondary-color); font-weight: 700;">${a.current_points.toLocaleString()}</td>
            <td><span class="badge badge-primary">${(a.classification || 'new').toUpperCase()}</span></td>
            <td><span class="badge ${a.status === 'active' ? 'badge-active' : 'badge-banned'}">${a.status.toUpperCase()}</span></td>
            <td>
                <div style="display: flex; gap: 0.4rem; flex-wrap: wrap;">
                    <button class="btn secondary-btn" style="padding: 0.35rem 0.65rem; font-size: 0.78rem;" onclick="openAccountDetailsPage(${a.id})">
                        <i class="fa-solid fa-circle-info"></i> Details
                    </button>
                    <button class="btn secondary-btn" style="padding: 0.35rem 0.65rem; font-size: 0.78rem;" onclick="openPointsUpdateModal(${a.id}, '${escapeHtml(a.email)}', ${a.current_points})">
                        <i class="fa-solid fa-bolt"></i> Points
                    </button>
                    <button class="btn secondary-btn" style="padding: 0.35rem 0.65rem; font-size: 0.78rem;" onclick="openEditAccountModal(${a.id})">
                        <i class="fa-solid fa-pen"></i> Edit
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
}

async function assignAllAccountsToOperator() {
    let users = window._allPlatformUsers || [];
    if (users.length === 0) {
        try {
            const res = await fetch('/api/admin/users', { headers: { 'Authorization': `Bearer ${currentToken}` } });
            if (res.ok) {
                users = await res.json();
                window._allPlatformUsers = users;
            }
        } catch (e) {}
    }

    const defaultTarget = users.find(u => u.email.toLowerCase() === 'laptopmew1@gmail.com') || users.find(u => u.role !== 'admin') || users[0];
    const defaultEmail = defaultTarget ? defaultTarget.email : 'laptopmew1@gmail.com';

    const targetEmail = prompt(
        'Move ALL platform accounts to an operator.\n\nEnter the operator Gmail address:\n(Default: laptopmew1@gmail.com)',
        defaultEmail
    );

    if (!targetEmail || !targetEmail.trim()) return;

    const matched = users.find(u => u.email.toLowerCase() === targetEmail.trim().toLowerCase());
    if (!matched) {
        showToast('User Not Found', `No registered user found with email "${targetEmail.trim()}".`, 'warning');
        return;
    }

    if (!confirm(`Are you sure you want to move ALL accounts to ${matched.displayName || matched.name} (${matched.email})?`)) {
        return;
    }

    try {
        const res = await fetch(`/api/admin/users/${matched.id}/claim-all-accounts`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${currentToken}` }
        });
        const data = await res.json();
        if (res.ok) {
            showToast('All Accounts Assigned', data.message || `All accounts moved to ${matched.email}`);
            loadAllAccounts();
        } else {
            showToast('Error', data.error || 'Failed to assign accounts', 'danger');
        }
    } catch (e) {
        showToast('Error', 'Request failed', 'danger');
    }
}
window.assignAllAccountsToOperator = assignAllAccountsToOperator;

// -----------------------------------------------------------------------------
// DEDICATED ACCOUNT DETAILS PAGE (ADMIN & USER)
// -----------------------------------------------------------------------------
let lastActivePageBeforeDetails = null;

async function openAccountDetailsPage(accountId) {
    try {
        const res = await fetch(`/api/accounts/${accountId}/details`, {
            headers: { 'Authorization': `Bearer ${currentToken}` }
        });
        if (!res.ok) {
            const err = await res.json();
            showToast('Access Denied', err.error || 'Unable to open account details.', 'danger');
            return;
        }
        const data = await res.json();
        const acc = data.account;
        const ed = data.editingStatus;
        const logs = data.activityLogs || [];
        const isAdmin = data.isAdmin;

        // Remember which page was open
        const visiblePage = document.querySelector('.page-pane:not(.hidden)');
        if (visiblePage && visiblePage.id !== 'page-account-details') {
            lastActivePageBeforeDetails = visiblePage.id;
        }

        // Hide all pages, show page-account-details
        document.querySelectorAll('.page-pane').forEach(p => p.classList.add('hidden'));
        const detailsPane = document.getElementById('page-account-details');
        detailsPane.classList.remove('hidden');
        document.getElementById('current-view-title').textContent = `Account Details: P${formatProfileNo(acc.profile_no)} (${acc.email})`;

        // Populate Banner
        document.getElementById('acc-detail-profile-badge').textContent = `P${formatProfileNo(acc.profile_no)}`;
        document.getElementById('acc-detail-email-title').textContent = acc.email;
        
        const statusBadge = document.getElementById('acc-detail-status-badge');
        statusBadge.textContent = (acc.status || 'active').toUpperCase();
        statusBadge.className = `badge ${acc.status === 'active' ? 'badge-active' : 'badge-banned'}`;

        const classBadge = document.getElementById('acc-detail-class-badge');
        classBadge.textContent = acc.classification === 'old' ? 'Old Account' : 'New Account';
        classBadge.className = 'badge badge-primary';

        const ownerPill = document.getElementById('acc-detail-owner-pill');
        if (isAdmin && acc.owner) {
            ownerPill.style.display = 'inline-block';
            ownerPill.textContent = `Assigned User: ${acc.owner.name} (${acc.owner.email})`;
        } else {
            ownerPill.style.display = 'none';
        }

        const windowPill = document.getElementById('acc-detail-window-pill');
        windowPill.innerHTML = `<span class="badge ${ed.isWithinWindow ? 'badge-active' : 'badge-pending'}"><i class="fa-solid fa-clock"></i> ${ed.statusText}</span>`;

        // Section A: Overview
        const elProfNo = document.getElementById('acc-detail-prof-no');
        if (elProfNo) elProfNo.textContent = formatProfileNo(acc.profile_no);

        const elEmail = document.getElementById('acc-detail-email');
        if (elEmail) elEmail.textContent = acc.email || '-';

        const elServerOverview = document.getElementById('acc-detail-server-overview');
        if (elServerOverview) elServerOverview.textContent = acc.server || 'None';

        const elStatus = document.getElementById('acc-detail-status');
        if (elStatus) {
            elStatus.textContent = (acc.status || 'active').toUpperCase();
            elStatus.className = `badge ${acc.status === 'active' ? 'badge-active' : 'badge-banned'}`;
        }

        const elClass = document.getElementById('acc-detail-classification');
        if (elClass) {
            elClass.textContent = acc.classification === 'old' ? 'Old Account' : 'New Account';
            elClass.className = 'badge badge-primary';
        }

        const elCreated = document.getElementById('acc-detail-created');
        if (elCreated) elCreated.textContent = acc.createdAt ? new Date(acc.createdAt).toLocaleString() : 'Legacy Record';

        const elUpdated = document.getElementById('acc-detail-updated');
        if (elUpdated) elUpdated.textContent = acc.lastUpdated ? new Date(acc.lastUpdated).toLocaleString() : 'Not modified';

        const elNotes = document.getElementById('acc-detail-notes');
        if (elNotes) elNotes.textContent = acc.notes || 'None';

        // Section B: Credentials & Information (Plaintext Direct Access)
        const elCredEmail = document.getElementById('acc-detail-cred-email');
        if (elCredEmail) {
            elCredEmail.textContent = acc.email || '-';
            elCredEmail.setAttribute('data-real-value', acc.email || '');
        }

        const elCredEmailPass = document.getElementById('acc-detail-cred-email-pass');
        if (elCredEmailPass) {
            const passVal = acc.email_password || 'None';
            elCredEmailPass.textContent = passVal;
            elCredEmailPass.setAttribute('data-real-value', passVal);
            elCredEmailPass.setAttribute('data-masked', 'false');
        }

        const elCredServer = document.getElementById('acc-detail-cred-server');
        if (elCredServer) {
            elCredServer.textContent = acc.server || 'None';
            elCredServer.setAttribute('data-real-value', acc.server || '');
        }

        const elCredProton = document.getElementById('acc-detail-cred-proton');
        if (elCredProton) {
            elCredProton.textContent = acc.proton_email || 'None';
            elCredProton.setAttribute('data-real-value', acc.proton_email || '');
        }

        const elCredProtonPass = document.getElementById('acc-detail-cred-proton-pass');
        if (elCredProtonPass) {
            const protPassVal = acc.proton_password || 'None';
            elCredProtonPass.textContent = protPassVal;
            elCredProtonPass.setAttribute('data-real-value', protPassVal);
            elCredProtonPass.setAttribute('data-masked', 'false');
        }

        const elCredAlt = document.getElementById('acc-detail-cred-alt');
        if (elCredAlt) {
            const altVal = acc.alternative_email || acc.recovery_email || 'None';
            elCredAlt.textContent = altVal;
            elCredAlt.setAttribute('data-real-value', altVal);
        }

        const elCredAltPass = document.getElementById('acc-detail-cred-alt-pass');
        if (elCredAltPass) {
            const altPassVal = acc.alternative_password || 'None';
            elCredAltPass.textContent = altPassVal;
            elCredAltPass.setAttribute('data-real-value', altPassVal);
            elCredAltPass.setAttribute('data-masked', 'false');
        }

        // Section C: Activity Log (Administrative Only)
        const actBody = document.getElementById('acc-detail-activity-body');
        if (logs.length === 0) {
            actBody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">No administrative modifications recorded yet.</td></tr>';
        } else {
            actBody.innerHTML = logs.map(l => `
                <tr>
                    <td class="text-secondary">${new Date(l.created_at).toLocaleString()}</td>
                    <td><span class="badge badge-primary">${escapeHtml(l.action_type || 'UPDATE')}</span></td>
                    <td>${escapeHtml(l.description || '-')}</td>
                    <td><strong>${escapeHtml(l.actor_name || 'System')}</strong> <span class="text-secondary" style="font-size: 0.78rem;">(${escapeHtml(l.actor_email || '')})</span></td>
                    <td><span class="badge ${l.actor_role === 'admin' ? 'badge-active' : 'badge-secondary'}">${(l.actor_role || 'USER').toUpperCase()}</span></td>
                </tr>
            `).join('');
        }

        // Top Action Bar
        const bar = document.getElementById('account-details-action-bar');
        if (isAdmin) {
            bar.innerHTML = `
                <button class="btn primary-btn" onclick="openEditAccountModal(${acc.id})"><i class="fa-solid fa-pen"></i> Edit Information</button>
                <button class="btn secondary-btn" onclick="openAdminEditingPeriodModal(${acc.user_id || ''})"><i class="fa-solid fa-clock"></i> User Window Config</button>
            `;
        } else {
            if (ed.canEdit) {
                bar.innerHTML = `
                    <button class="btn primary-btn" onclick="openEditAccountModal(${acc.id})"><i class="fa-solid fa-pen"></i> Edit Information</button>
                `;
            } else {
                bar.innerHTML = `
                    <button class="btn primary-btn" onclick="openAccountCorrectionModal(${acc.id}, '${escapeHtml(acc.email)}')"><i class="fa-solid fa-pen-ruler"></i> Request Correction / Edit</button>
                `;
            }
        }

    } catch (e) {
        console.error('Failed to open account details:', e);
        showToast('Error', 'Unable to fetch account details', 'danger');
    }
}

function closeAccountDetailsPage() {
    document.getElementById('page-account-details').classList.add('hidden');
    if (lastActivePageBeforeDetails) {
        const prev = document.getElementById(lastActivePageBeforeDetails);
        if (prev) prev.classList.remove('hidden');
        else if (currentUser.role === 'admin') showAdminPage('admin-all-accounts');
        else showUserPage('user-active-accounts');
    } else {
        if (currentUser.role === 'admin') showAdminPage('admin-all-accounts');
        else showUserPage('user-active-accounts');
    }
}

// -----------------------------------------------------------------------------
// ACCOUNT CREATION & EDITING MODAL
// -----------------------------------------------------------------------------
async function populateAccountOwnerDropdown(selectedUserId) {
    const container = document.getElementById('acc-owner-container');
    const select = document.getElementById('acc-owner-id');
    if (!container || !select) return;

    if (!currentUser || currentUser.role !== 'admin') {
        container.style.display = 'none';
        return;
    }

    container.style.display = 'block';

    let users = window._allPlatformUsers;
    if (!users || users.length === 0) {
        try {
            const res = await fetch('/api/admin/users', { headers: { 'Authorization': `Bearer ${currentToken}` } });
            if (res.ok) {
                users = await res.json();
                window._allPlatformUsers = users;
            }
        } catch (e) {}
    }

    const defaultAdminUser = users?.find(u => u.role === 'admin') || { id: 1, name: 'Sole Administrator', email: '001.workme@gmail.com' };
    select.innerHTML = (users || [defaultAdminUser]).map(u => `
        <option value="${u.id}">${escapeHtml(u.displayName || u.name)} (${escapeHtml(u.email)})${u.role === 'admin' ? ' [ADMIN]' : ''}</option>
    `).join('');

    if (selectedUserId) {
        select.value = selectedUserId;
    } else {
        select.value = defaultAdminUser.id;
    }
}

function openCreateAccountModal() {
    document.getElementById('modal-account-title').textContent = 'Add Account Profile';
    document.getElementById('acc-id').value = '';
    document.getElementById('acc-profile-no').value = '';
    document.getElementById('acc-email').value = '';
    document.getElementById('acc-email').readOnly = false;
    document.getElementById('acc-email-password').value = '';
    document.getElementById('acc-server').value = '';
    document.getElementById('acc-proton-email').value = '';
    document.getElementById('acc-proton-password').value = '';
    document.getElementById('acc-alt-email').value = '';
    document.getElementById('acc-alt-password').value = '';
    document.getElementById('acc-classification').value = 'new';
    document.getElementById('acc-status').value = 'active';
    document.getElementById('acc-initial-points').value = '0';
    document.getElementById('acc-initial-points').closest('.form-group').style.display = 'block';
    document.getElementById('acc-notes').value = '';
    populateAccountOwnerDropdown();
    openModal('modal-account');
}

async function openEditAccountModal(accountId) {
    try {
        const res = await fetch(`/api/accounts/${accountId}/details`, {
            headers: { 'Authorization': `Bearer ${currentToken}` }
        });
        if (!res.ok) return;
        const data = await res.json();
        const acc = data.account;

        document.getElementById('modal-account-title').textContent = `Edit Account: P${formatProfileNo(acc.profile_no)} (${acc.email})`;
        document.getElementById('acc-id').value = acc.id;
        document.getElementById('acc-profile-no').value = acc.profile_no || '';
        document.getElementById('acc-email').value = acc.email;
        document.getElementById('acc-email-password').value = acc.email_password || '';
        document.getElementById('acc-server').value = acc.server || '';
        document.getElementById('acc-proton-email').value = acc.proton_email || '';
        document.getElementById('acc-proton-password').value = acc.proton_password || '';
        document.getElementById('acc-alt-email').value = acc.alternative_email || acc.recovery_email || '';
        document.getElementById('acc-alt-password').value = acc.alternative_password || '';
        document.getElementById('acc-classification').value = acc.classification || 'new';
        document.getElementById('acc-status').value = acc.status || 'active';
        document.getElementById('acc-initial-points').closest('.form-group').style.display = 'none';
        document.getElementById('acc-notes').value = acc.notes || '';
        populateAccountOwnerDropdown(acc.user_id || acc.owner_id);
        openModal('modal-account');
    } catch (e) {
        showToast('Error', 'Failed to load account for editing', 'danger');
    }
}

async function saveAccountRecord() {
    const accId = document.getElementById('acc-id').value;
    const profileNo = document.getElementById('acc-profile-no').value;
    const email = document.getElementById('acc-email').value.trim();
    const emailPassword = document.getElementById('acc-email-password').value;
    const server = document.getElementById('acc-server').value.trim();
    const protonEmail = document.getElementById('acc-proton-email').value.trim();
    const protonPassword = document.getElementById('acc-proton-password').value;
    const altEmail = document.getElementById('acc-alt-email').value.trim();
    const altPassword = document.getElementById('acc-alt-password').value;
    const classification = document.getElementById('acc-classification').value;
    const status = document.getElementById('acc-status').value;
    const initialPoints = parseInt(document.getElementById('acc-initial-points').value) || 0;
    const notes = document.getElementById('acc-notes').value.trim();
    const ownerId = document.getElementById('acc-owner-id')?.value;

    if (!email) {
        showToast('Required', 'Please enter account email / identifier', 'warning');
        return;
    }

    try {
        let res;
        const payload = {
            profileNo: profileNo ? Number(profileNo) : undefined,
            email,
            email_password: emailPassword,
            server,
            proton_email: protonEmail,
            proton_password: protonPassword,
            alternative_email: altEmail,
            alternative_password: altPassword,
            classification,
            status,
            notes,
            user_id: ownerId ? Number(ownerId) : undefined
        };

        if (accId) {
            res = await fetch(`/api/accounts/${accId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentToken}` },
                body: JSON.stringify(payload)
            });
        } else {
            payload.initial_points = initialPoints;
            payload.currentPoints = initialPoints;
            res = await fetch('/api/accounts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentToken}` },
                body: JSON.stringify(payload)
            });
        }

        const data = await res.json();
        if (res.ok) {
            closeModal('modal-account');
            showToast('Account Saved', data.message || 'Account successfully saved.');
            if (currentUser.role === 'admin') {
                loadAllAccounts();
            } else {
                loadUserAccounts();
            }
            if (accId) {
                openAccountDetailsPage(accId);
            }
        } else {
            showToast('Error', data.error || 'Failed to save account', 'danger');
        }
    } catch (e) {
        showToast('Error', 'Failed to save account', 'danger');
    }
}

// -----------------------------------------------------------------------------
// EXCEL / CSV UPLOAD (ADMIN & USER)
// -----------------------------------------------------------------------------
function openUploadExcelModal() {
    document.getElementById('excel-file-input').value = '';
    document.getElementById('fresh-upload-check').checked = false;
    openModal('modal-upload-excel');
}

async function submitExcelUpload() {
    const fileInput = document.getElementById('excel-file-input');
    const isFresh = document.getElementById('fresh-upload-check').checked;

    if (!fileInput.files || fileInput.files.length === 0) {
        showToast('File Required', 'Please select a .xlsx or .csv file.', 'warning');
        return;
    }

    const formData = new FormData();
    formData.append('file', fileInput.files[0]);
    formData.append('isFresh', isFresh);

    showToast('Uploading', 'Processing spreadsheet and synchronizing accounts...');

    try {
        const res = await fetch('/api/accounts/upload-excel', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${currentToken}` },
            body: formData
        });
        const data = await res.json();
        if (res.ok) {
            closeModal('modal-upload-excel');
            showToast('Import Succeeded', `Processed ${data.totalRows} accounts (${data.created} created, ${data.updated} updated).`);
            if (currentUser.role === 'admin') loadAllAccounts();
            else loadUserAccounts();
        } else {
            showToast('Upload Failed', data.error || 'Failed to process spreadsheet', 'danger');
        }
    } catch (e) {
        showToast('Error', 'Excel upload request failed', 'danger');
    }
}

// -----------------------------------------------------------------------------
// ACCOUNT CORRECTION REQUESTS (USER -> ADMIN)
// -----------------------------------------------------------------------------
function openAccountCorrectionModal(accountId, accountEmail) {
    document.getElementById('corr-acc-id').value = accountId;
    document.getElementById('corr-acc-email').value = accountEmail;
    document.getElementById('corr-field').value = 'Recovery Email';
    document.getElementById('corr-prev-val').value = '';
    document.getElementById('corr-new-val').value = '';
    document.getElementById('corr-reason').value = '';
    openModal('modal-account-correction-request');
}

async function submitAccountCorrection() {
    const accountId = document.getElementById('corr-acc-id').value;
    const fieldName = document.getElementById('corr-field').value;
    const previousValue = document.getElementById('corr-prev-val').value.trim();
    const newValue = document.getElementById('corr-new-val').value.trim();
    const reason = document.getElementById('corr-reason').value.trim();

    if (!newValue || !reason) {
        showToast('Required', 'Please enter the new requested value and reason.', 'warning');
        return;
    }

    try {
        const res = await fetch(`/api/accounts/${accountId}/correction-request`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentToken}` },
            body: JSON.stringify({ fieldName, previousValue, newValue, reason })
        });
        const data = await res.json();
        if (res.ok) {
            closeModal('modal-account-correction-request');
            showToast('Request Submitted', data.message || 'Correction request sent to administrator.');
            if (!document.getElementById('page-account-details').classList.contains('hidden')) {
                openAccountDetailsPage(accountId);
            }
        } else {
            showToast('Failed', data.error || 'Could not submit correction request.', 'danger');
        }
    } catch (e) {
        showToast('Error', 'Submission failed', 'danger');
    }
}

// -----------------------------------------------------------------------------
// ADMIN FREE EDITING PERIOD CONFIGURATION
// -----------------------------------------------------------------------------
async function openAdminEditingPeriodModal(targetUserId) {
    try {
        const usersRes = await fetch('/api/admin/users', {
            headers: { 'Authorization': `Bearer ${currentToken}` }
        });
        const users = await usersRes.json();
        const select = document.getElementById('aep-target-user');
        select.innerHTML = '<option value="">Global Default (All Registered Users)</option>' +
            users.filter(u => u.status === 'approved').map(u => `<option value="${u.id}">${escapeHtml(u.name)} (${escapeHtml(u.email)})</option>`).join('');

        if (targetUserId) {
            select.value = String(targetUserId);
        }

        await onAdminEditingScopeChange();
        openModal('modal-admin-editing-period');
    } catch (e) {
        console.error('Failed to open editing period modal:', e);
    }
}

async function onAdminEditingScopeChange() {
    const userId = document.getElementById('aep-target-user').value;
    try {
        const res = await fetch(`/api/admin/editing-periods?userId=${userId}`, {
            headers: { 'Authorization': `Bearer ${currentToken}` }
        });
        if (!res.ok) return;
        const cfg = await res.json();
        document.getElementById('aep-enabled').checked = !!cfg.enabled;
        document.getElementById('aep-duration').value = cfg.duration_value || 7;
        document.getElementById('aep-unit').value = cfg.duration_unit || 'days';
        document.getElementById('aep-start-event').value = cfg.start_event || 'user_approval';
        document.getElementById('aep-apply-add').checked = !!cfg.apply_to_add;
        document.getElementById('aep-apply-edit').checked = !!cfg.apply_to_edit;
    } catch (e) {}
}

async function saveAdminEditingPeriodConfig() {
    const userId = document.getElementById('aep-target-user').value || null;
    const enabled = document.getElementById('aep-enabled').checked;
    const durationValue = parseInt(document.getElementById('aep-duration').value) || 7;
    const durationUnit = document.getElementById('aep-unit').value;
    const startEvent = document.getElementById('aep-start-event').value;
    const applyToAdd = document.getElementById('aep-apply-add').checked;
    const applyToEdit = document.getElementById('aep-apply-edit').checked;

    try {
        const res = await fetch('/api/admin/editing-periods', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentToken}` },
            body: JSON.stringify({
                userId,
                enabled,
                durationValue,
                durationUnit,
                startEvent,
                applyToAdd,
                applyToEdit
            })
        });
        const data = await res.json();
        if (res.ok) {
            closeModal('modal-admin-editing-period');
            showToast('Configuration Saved', data.message || 'Free editing period configured.');
        } else {
            showToast('Error', data.error || 'Failed to save configuration', 'danger');
        }
    } catch (e) {
        showToast('Error', 'Save failed', 'danger');
    }
}

async function scheduleDossierWindow(userId, minutes) {
    try {
        const res = await fetch(`/api/admin/users/${userId}/schedule-window`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentToken}` },
            body: JSON.stringify({ durationMinutes: minutes, permittedActions: ['update_points', 'edit_accounts', 'add_accounts', 'import_excel'] })
        });
        if (res.ok) {
            showToast('Window Granted', `Granted ${Math.round(minutes / 60)} hour temporary access window.`);
            openUserDetails(userId);
        } else {
            showToast('Error', 'Failed to schedule window', 'danger');
        }
    } catch (e) {
        showToast('Error', 'Schedule failed', 'danger');
    }
}

async function revokeDossierUserWindow(userId) {
    if (!confirm('Immediately revoke write access and lock user to Read-Only mode?')) return;
    try {
        const res = await fetch(`/api/admin/users/${userId}/revoke-window`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${currentToken}` }
        });
        if (res.ok) {
            showToast('Access Locked', 'User returned to Read-Only mode.');
            openUserDetails(userId);
        }
    } catch (e) {
        showToast('Error', 'Revoke failed', 'danger');
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
                    <strong>${formatProfileNo(a.profile_no)} • ${escapeHtml(a.email.split('@')[0])}</strong>
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

// -----------------------------------------------------------------------------
// 4B. POINTS MANAGEMENT & ACCESS PERMISSIONS (ADMIN)
// -----------------------------------------------------------------------------
async function loadAdminPointsPerms() {
    try {
        const [usersRes, reqRes] = await Promise.all([
            fetch('/api/admin/users', { headers: { 'Authorization': `Bearer ${currentToken}` } }),
            fetch('/api/requests/all', { headers: { 'Authorization': `Bearer ${currentToken}` } })
        ]);

        if (!usersRes.ok) return;
        const users = await usersRes.json();
        const nonAdminUsers = users.filter(u => u.status === 'approved');
        window._adminPointsUsers = nonAdminUsers;

        // 1. Populate Target User Select in Scheduler
        const select = document.getElementById('sched-target-user');
        if (select) {
            const currentSelected = select.value;
            select.innerHTML = nonAdminUsers.map(u => 
                `<option value="${u.id}">${escapeHtml(u.displayName || u.name || u.email)} (${escapeHtml(u.email)}) [${u.accountsCount} accounts]</option>`
            ).join('');
            if (currentSelected && nonAdminUsers.some(u => String(u.id) === String(currentSelected))) {
                select.value = currentSelected;
            } else if (nonAdminUsers.length > 0) {
                const laptop = nonAdminUsers.find(u => u.email.toLowerCase() === 'laptopmew1@gmail.com');
                select.value = laptop ? laptop.id : nonAdminUsers[0].id;
            }
        }

        // 2. Load and render user permission cards with 1-click toggles
        await renderAdminUserQuickToggles(nonAdminUsers);

        // 3. Update scheduler status for selected user
        await onScheduleTargetUserChange();

        // 4. Render pending requests
        if (reqRes.ok) {
            const requests = await reqRes.json();
            renderAdminAccessRequests(requests);
        }

    } catch (e) {
        console.error('Failed to load points & access permissions:', e);
    }
}

async function renderAdminUserQuickToggles(users) {
    const container = document.getElementById('admin-user-quick-toggles-container');
    if (!container) return;

    if (!users || users.length === 0) {
        container.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 2rem;">No approved operator users found.</div>`;
        return;
    }

    const detailsPromises = users.map(u => 
        fetch(`/api/admin/users/${u.id}`, { headers: { 'Authorization': `Bearer ${currentToken}` } })
            .then(r => r.ok ? r.json() : null)
            .catch(() => null)
    );
    const detailsList = await Promise.all(detailsPromises);

    container.innerHTML = users.map((u, idx) => {
        const details = detailsList[idx];
        const perms = details?.permissions?.map(p => p.permission_key) || [];
        const hasPoints = perms.includes('update_points');
        const hasEdit = perms.includes('edit_accounts');
        const hasAdd = perms.includes('add_accounts');
        const hasImport = perms.includes('import_excel');

        const now = new Date();
        const activeWin = details?.tempWindows?.find(w => w.is_active && new Date(w.start_time) <= now && new Date(w.end_time) >= now);
        const isReadOnly = !hasPoints && !hasEdit && !hasAdd && !activeWin;

        return `
            <div style="background: var(--bg-color); border: 1px solid var(--border-color); border-radius: 10px; padding: 1.25rem;">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.85rem; flex-wrap: wrap; gap: 0.5rem;">
                    <div>
                        <div style="font-weight: 700; font-size: 1rem; color: #fff;">${escapeHtml(u.displayName || u.name)}</div>
                        <div class="text-secondary" style="font-size: 0.82rem;">${escapeHtml(u.email)} · ${u.accountsCount} Accounts Assigned</div>
                    </div>
                    <div>
                        ${activeWin ? `
                            <span class="badge badge-active" title="Expires at ${new Date(activeWin.end_time).toLocaleTimeString()}">
                                🟢 Write Window Active
                            </span>
                        ` : (isReadOnly ? `
                            <span class="badge badge-pending">🔒 Read-Only Mode</span>
                        ` : `
                            <span class="badge badge-active">✏️ Write Enabled</span>
                        `)}
                    </div>
                </div>

                <!-- 4 TOGGLE SWITCHES -->
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 0.75rem;">
                    <!-- TOGGLE 1: POINTS EDITING -->
                    <div style="background: rgba(15, 23, 42, 0.5); padding: 0.75rem; border-radius: 8px; border: 1px solid var(--border-color);">
                        <div style="font-size: 0.75rem; font-weight: 600; color: var(--text-secondary); margin-bottom: 0.4rem;">Points Updating</div>
                        <button class="btn ${hasPoints ? 'primary-btn' : 'secondary-btn'}" 
                                style="width: 100%; font-size: 0.78rem; padding: 0.35rem 0.6rem; justify-content: center; ${hasPoints ? 'background: #10b981; border-color: #10b981; color: #fff;' : 'background: rgba(100, 116, 139, 0.2); color: #94a3b8;'}"
                                onclick="quickToggleUserPerm(${u.id}, 'update_points', ${!hasPoints})">
                            <i class="fa-solid fa-${hasPoints ? 'check' : 'lock'}"></i> ${hasPoints ? 'Write Allowed ✏️' : 'Read-Only 🔒'}
                        </button>
                    </div>

                    <!-- TOGGLE 2: ACCOUNT EDITING -->
                    <div style="background: rgba(15, 23, 42, 0.5); padding: 0.75rem; border-radius: 8px; border: 1px solid var(--border-color);">
                        <div style="font-size: 0.75rem; font-weight: 600; color: var(--text-secondary); margin-bottom: 0.4rem;">Account Info Editing</div>
                        <button class="btn ${hasEdit ? 'primary-btn' : 'secondary-btn'}" 
                                style="width: 100%; font-size: 0.78rem; padding: 0.35rem 0.6rem; justify-content: center; ${hasEdit ? 'background: #10b981; border-color: #10b981; color: #fff;' : 'background: rgba(100, 116, 139, 0.2); color: #94a3b8;'}"
                                onclick="quickToggleUserPerm(${u.id}, 'edit_accounts', ${!hasEdit})">
                            <i class="fa-solid fa-${hasEdit ? 'check' : 'lock'}"></i> ${hasEdit ? 'Write Allowed ✏️' : 'Read-Only 🔒'}
                        </button>
                    </div>

                    <!-- TOGGLE 3: ADD ACCOUNTS -->
                    <div style="background: rgba(15, 23, 42, 0.5); padding: 0.75rem; border-radius: 8px; border: 1px solid var(--border-color);">
                        <div style="font-size: 0.75rem; font-weight: 600; color: var(--text-secondary); margin-bottom: 0.4rem;">Add Accounts</div>
                        <button class="btn ${hasAdd ? 'primary-btn' : 'secondary-btn'}" 
                                style="width: 100%; font-size: 0.78rem; padding: 0.35rem 0.6rem; justify-content: center; ${hasAdd ? 'background: #10b981; border-color: #10b981; color: #fff;' : 'background: rgba(100, 116, 139, 0.2); color: #94a3b8;'}"
                                onclick="quickToggleUserPerm(${u.id}, 'add_accounts', ${!hasAdd})">
                            <i class="fa-solid fa-${hasAdd ? 'plus' : 'ban'}"></i> ${hasAdd ? 'Allowed ➕' : 'Blocked 🔒'}
                        </button>
                    </div>

                    <!-- TOGGLE 4: IMPORT EXCEL -->
                    <div style="background: rgba(15, 23, 42, 0.5); padding: 0.75rem; border-radius: 8px; border: 1px solid var(--border-color);">
                        <div style="font-size: 0.75rem; font-weight: 600; color: var(--text-secondary); margin-bottom: 0.4rem;">Excel Upload</div>
                        <button class="btn ${hasImport ? 'primary-btn' : 'secondary-btn'}" 
                                style="width: 100%; font-size: 0.78rem; padding: 0.35rem 0.6rem; justify-content: center; ${hasImport ? 'background: #10b981; border-color: #10b981; color: #fff;' : 'background: rgba(100, 116, 139, 0.2); color: #94a3b8;'}"
                                onclick="quickToggleUserPerm(${u.id}, 'import_excel', ${!hasImport})">
                            <i class="fa-solid fa-${hasImport ? 'file-excel' : 'ban'}"></i> ${hasImport ? 'Allowed 📥' : 'Blocked 🔒'}
                        </button>
                    </div>
                </div>

                <div style="display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 0.75rem;">
                    <button class="btn secondary-btn" style="padding: 0.3rem 0.6rem; font-size: 0.76rem;" onclick="setSchedulerUser(${u.id})">
                        <i class="fa-solid fa-clock"></i> Schedule Window
                    </button>
                    <button class="btn secondary-btn" style="padding: 0.3rem 0.6rem; font-size: 0.76rem;" onclick="openUserDetails(${u.id})">
                        <i class="fa-solid fa-address-card"></i> Open Dossier
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

function setSchedulerUser(userId) {
    const select = document.getElementById('sched-target-user');
    if (select) {
        select.value = userId;
        onScheduleTargetUserChange();
        select.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

async function onScheduleTargetUserChange() {
    const select = document.getElementById('sched-target-user');
    if (!select || !select.value) return;
    const userId = select.value;

    try {
        const res = await fetch(`/api/admin/users/${userId}`, {
            headers: { 'Authorization': `Bearer ${currentToken}` }
        });
        if (!res.ok) return;
        const data = await res.json();

        const badge = document.getElementById('sched-current-status-badge');
        const timer = document.getElementById('sched-active-window-timer');

        const now = new Date();
        const activeWin = data.tempWindows?.find(w => w.is_active && new Date(w.start_time) <= now && new Date(w.end_time) >= now);

        if (activeWin) {
            const end = new Date(activeWin.end_time);
            const remainingMs = Math.max(0, end.getTime() - now.getTime());
            const hours = Math.floor(remainingMs / (3600 * 1000));
            const mins = Math.floor((remainingMs % (3600 * 1000)) / 60000);
            const timeStr = hours > 0 ? `${hours}h ${mins}m remaining` : `${mins}m remaining`;

            if (badge) {
                badge.className = 'badge badge-active';
                badge.textContent = 'Write Window Active';
            }
            if (timer) {
                timer.innerHTML = `🟢 <strong>Temporary Window Active:</strong> ${timeStr} (Expires at ${end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`;
            }
        } else {
            const perms = data.permissions?.map(p => p.permission_key) || [];
            const hasWrite = perms.includes('update_points') || perms.includes('edit_accounts');
            if (badge) {
                badge.className = hasWrite ? 'badge badge-active' : 'badge badge-pending';
                badge.textContent = hasWrite ? 'Write Allowed' : 'Read-Only Mode';
            }
            if (timer) {
                timer.textContent = hasWrite 
                    ? 'Write access is currently granted via permanent permission toggle.' 
                    : 'No active temporary window. User is strictly in Read-Only mode.';
            }
        }
    } catch (e) {}
}

function selectScheduleDuration(mins, btnElement) {
    document.querySelectorAll('.sched-preset-btn').forEach(b => {
        b.style.background = '';
        b.style.color = '';
        b.classList.remove('active');
    });

    if (btnElement) {
        btnElement.classList.add('active');
        btnElement.style.background = 'var(--primary-color)';
        btnElement.style.color = '#fff';
    }

    const customContainer = document.getElementById('sched-custom-time-container');
    const hiddenInput = document.getElementById('sched-duration-minutes');

    if (mins === 'custom') {
        if (customContainer) customContainer.style.display = 'block';
        if (hiddenInput) hiddenInput.value = 'custom';
    } else {
        if (customContainer) customContainer.style.display = 'none';
        if (hiddenInput) hiddenInput.value = mins;
    }
}

async function submitScheduleWindow() {
    const select = document.getElementById('sched-target-user');
    const userId = select?.value;
    if (!userId) {
        showToast('Error', 'Please select a target user', 'danger');
        return;
    }

    const durationVal = document.getElementById('sched-duration-minutes')?.value || '60';
    let durationMinutes = 60;
    let customEndTime = null;

    if (durationVal === 'custom') {
        const customInput = document.getElementById('sched-custom-endtime');
        if (!customInput || !customInput.value) {
            showToast('Error', 'Please choose a custom end date and time', 'danger');
            return;
        }
        customEndTime = new Date(customInput.value).toISOString();
    } else {
        durationMinutes = parseInt(durationVal) || 60;
    }

    const permittedActions = [];
    if (document.getElementById('sched-action-points')?.checked) permittedActions.push('update_points');
    if (document.getElementById('sched-action-edit')?.checked) permittedActions.push('edit_accounts');
    if (document.getElementById('sched-action-add')?.checked) {
        permittedActions.push('add_accounts');
        permittedActions.push('import_excel');
    }

    if (permittedActions.length === 0) {
        showToast('Error', 'Please check at least one permitted action', 'danger');
        return;
    }

    try {
        const res = await fetch(`/api/admin/users/${userId}/schedule-window`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentToken}` },
            body: JSON.stringify({ durationMinutes, permittedActions, customEndTime })
        });
        const data = await res.json();
        if (res.ok) {
            showToast('Window Scheduled', `Granted temporary window until ${new Date(data.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
            loadAdminPointsPerms();
        } else {
            showToast('Failed', data.error || 'Failed to schedule window', 'danger');
        }
    } catch (e) {
        showToast('Error', 'Network error scheduling window', 'danger');
    }
}

async function submitRevokeWindow() {
    const select = document.getElementById('sched-target-user');
    const userId = select?.value;
    if (!userId) return;

    if (!confirm('Are you sure you want to lock this user to Read-Only mode immediately? All active editing windows will be terminated.')) return;

    try {
        const res = await fetch(`/api/admin/users/${userId}/revoke-window`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${currentToken}` }
        });
        if (res.ok) {
            showToast('Access Locked', 'User access has been locked to Read-Only mode.');
            loadAdminPointsPerms();
        } else {
            showToast('Error', 'Failed to revoke window', 'danger');
        }
    } catch (e) {
        showToast('Error', 'Failed to revoke window', 'danger');
    }
}

async function quickToggleUserPerm(userId, permKey, enable) {
    try {
        const res = await fetch(`/api/admin/users/${userId}/quick-toggle-perm`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentToken}` },
            body: JSON.stringify({ permissionKey: permKey, enable: Boolean(enable) })
        });
        const data = await res.json();
        if (res.ok) {
            const labelMap = {
                'update_points': 'Points Updating',
                'edit_accounts': 'Account Editing',
                'add_accounts': 'Add Accounts',
                'import_excel': 'Excel Upload'
            };
            const label = labelMap[permKey] || permKey;
            showToast('Permission Updated', `${label} set to ${enable ? 'Write Allowed ✏️' : 'Read-Only 🔒'}`);
            loadAdminPointsPerms();
            if (window._activeUserDetails && window._activeUserDetails.user.id === userId) {
                openUserDetails(userId);
            }
        } else {
            showToast('Error', data.error || 'Failed to toggle permission', 'danger');
        }
    } catch (e) {
        showToast('Error', 'Toggle failed', 'danger');
    }
}

function renderAdminAccessRequests(requests) {
    const container = document.getElementById('admin-access-requests-list');
    const countBadge = document.getElementById('admin-pending-req-count');
    if (!container) return;

    const pendingRequests = requests.filter(r => r.status === 'Pending');
    if (countBadge) countBadge.textContent = `${pendingRequests.length} Pending`;

    if (pendingRequests.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; color: var(--text-muted); padding: 2rem;">
                <i class="fa-solid fa-circle-check" style="color: var(--success-color); font-size: 1.5rem; margin-bottom: 0.5rem; display: block;"></i>
                No pending access or correction requests.
            </div>
        `;
        return;
    }

    container.innerHTML = pendingRequests.map(r => `
        <div style="background: var(--bg-color); border: 1px solid var(--border-color); border-radius: 8px; padding: 1rem; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem;">
            <div style="flex: 1; min-width: 250px;">
                <div style="display: flex; gap: 0.5rem; align-items: center; margin-bottom: 0.35rem;">
                    <span class="badge badge-primary">${r.request_id}</span>
                    <span class="badge badge-pending">${(r.category || 'Request').replace('_', ' ').toUpperCase()}</span>
                    <span style="font-size: 0.82rem; font-weight: 700; color: #fff;">${escapeHtml(r.subject)}</span>
                </div>
                <div class="text-secondary" style="font-size: 0.85rem; margin-bottom: 0.35rem;">${escapeHtml(r.message)}</div>
                <div class="text-muted" style="font-size: 0.76rem;">
                    By <strong>${escapeHtml(r.user_name || 'Operator')}</strong> (${escapeHtml(r.user_email)}) · ${new Date(r.created_at).toLocaleString()}
                </div>
            </div>
            <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
                <button class="btn secondary-btn" style="font-size: 0.78rem; padding: 0.4rem 0.75rem; background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3);"
                        onclick="approveRequestWithWindow('${r.request_id}', 60)">
                    <i class="fa-solid fa-bolt"></i> Approve 1h Window
                </button>
                <button class="btn primary-btn" style="font-size: 0.78rem; padding: 0.4rem 0.75rem;"
                        onclick="approveRequestWithWindow('${r.request_id}', 120)">
                    <i class="fa-solid fa-bolt"></i> Approve 2h Window
                </button>
                <button class="btn secondary-btn" style="font-size: 0.78rem; padding: 0.4rem 0.75rem;"
                        onclick="approveRequestWithWindow('${r.request_id}', 1440)">
                    <i class="fa-solid fa-clock"></i> Approve 24h
                </button>
                <button class="btn danger-btn" style="font-size: 0.78rem; padding: 0.4rem 0.75rem;"
                        onclick="rejectAccessRequest('${r.request_id}')">
                    <i class="fa-solid fa-xmark"></i> Reject
                </button>
            </div>
        </div>
    `).join('');
}

async function approveRequestWithWindow(requestId, minutes) {
    try {
        const res = await fetch(`/api/requests/${requestId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentToken}` },
            body: JSON.stringify({
                status: 'Approved',
                grantWindowMinutes: minutes,
                permittedActions: ['update_points', 'edit_accounts', 'add_accounts', 'import_excel'],
                adminResponse: `Approved by administrator with a ${Math.round(minutes / 60)} hour temporary access window.`
            })
        });
        if (res.ok) {
            showToast('Request Approved', `Granted ${Math.round(minutes / 60)}h access window to operator.`);
            loadAdminPointsPerms();
        } else {
            showToast('Error', 'Failed to approve request', 'danger');
        }
    } catch (e) {
        showToast('Error', 'Approval failed', 'danger');
    }
}

async function rejectAccessRequest(requestId) {
    const reason = prompt('Reason for rejection (optional):', 'Request denied by administrator.');
    if (reason === null) return;

    try {
        const res = await fetch(`/api/requests/${requestId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentToken}` },
            body: JSON.stringify({
                status: 'Rejected',
                adminResponse: reason
            })
        });
        if (res.ok) {
            showToast('Request Rejected', 'The request has been rejected.');
            loadAdminPointsPerms();
        }
    } catch (e) {
        showToast('Error', 'Rejection failed', 'danger');
    }
}

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

async function scheduleDossierWindow(userId, minutes) {
    try {
        const res = await fetch(`/api/admin/users/${userId}/schedule-window`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentToken}` },
            body: JSON.stringify({ durationMinutes: minutes, permittedActions: ['update_points', 'edit_accounts', 'add_accounts', 'import_excel'] })
        });
        if (res.ok) {
            showToast('Window Granted', `Granted ${Math.round(minutes / 60)} hour temporary access window.`);
            openUserDetails(userId);
        } else {
            showToast('Error', 'Failed to schedule window', 'danger');
        }
    } catch (e) {
        showToast('Error', 'Schedule failed', 'danger');
    }
}

async function revokeDossierUserWindow(userId) {
    if (!confirm('Immediately revoke write access and lock user to Read-Only mode?')) return;
    try {
        const res = await fetch(`/api/admin/users/${userId}/revoke-window`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${currentToken}` }
        });
        if (res.ok) {
            showToast('Access Locked', 'User returned to Read-Only mode.');
            openUserDetails(userId);
        }
    } catch (e) {
        showToast('Error', 'Revoke failed', 'danger');
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
        const [schRes, subRes, usersRes] = await Promise.all([
            fetch('/api/forms/active', { headers: { 'Authorization': `Bearer ${currentToken}` } }),
            fetch('/api/forms/submissions', { headers: { 'Authorization': `Bearer ${currentToken}` } }),
            fetch('/api/forms/user-statuses', { headers: { 'Authorization': `Bearer ${currentToken}` } })
        ]);
        const schedule = await schRes.json();
        const submissions = await subRes.json();
        const operators = await usersRes.json();

        const schCard = document.getElementById('admin-form-schedule-card');
        if (schCard && schedule.active) {
            schCard.innerHTML = `
                <div style="background: var(--bg-color); border: 1px solid var(--border-color); border-radius: 8px; padding: 1.25rem;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
                        <strong>${escapeHtml(schedule.title)}</strong>
                        <span class="badge badge-active">Active Template (Default Deadline: ${schedule.deadlineDay}th)</span>
                    </div>
                    <p class="text-secondary" style="font-size: 0.85rem; margin-bottom: 0.5rem;">
                        Configured with ${schedule.questions.length} review questions.
                        <strong>Notice:</strong> Operators only receive this form when you click "Send Form". When sent, their dashboard stops displaying until they complete it.
                    </p>
                </div>
            `;
        }

        // Render Operator Statuses Table
        const opBody = document.getElementById('admin-form-operators-body');
        if (opBody) {
            if (!operators || operators.length === 0) {
                opBody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">No approved operators registered yet.</td></tr>';
            } else {
                opBody.innerHTML = operators.map(u => {
                    const isLocked = u.review_form_required === 1;
                    const statusBadge = isLocked 
                        ? `<span class="badge badge-pending"><i class="fa-solid fa-lock"></i> Review Sent (Dashboard Blocked)</span>`
                        : `<span class="badge badge-active"><i class="fa-solid fa-circle-check"></i> Normal (Dashboard Resumed)</span>`;
                    const lastSub = u.last_submitted_at ? new Date(u.last_submitted_at).toLocaleString() : '<span class="text-secondary">Never</span>';
                    const actionBtn = isLocked
                        ? `<button class="btn secondary-btn" style="padding: 0.35rem 0.65rem; font-size: 0.78rem;" onclick="adminCancelReviewForm(${u.id})">
                               <i class="fa-solid fa-unlock"></i> Cancel & Resume Dashboard
                           </button>`
                        : `<button class="btn warning-btn" style="padding: 0.35rem 0.65rem; font-size: 0.78rem;" onclick="adminSendReviewForm(${u.id}, '${escapeHtml(u.name)}')">
                               <i class="fa-solid fa-paper-plane"></i> Send Form (Lock Dashboard)
                           </button>`;

                    return `
                        <tr>
                            <td>
                                <strong>${escapeHtml(u.name)}</strong>
                                <div class="text-secondary" style="font-size: 0.8rem;">${escapeHtml(u.email)}</div>
                            </td>
                            <td>${statusBadge}</td>
                            <td>${lastSub}</td>
                            <td>${actionBtn}</td>
                        </tr>
                    `;
                }).join('');
            }
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

async function adminSendReviewForm(userId, userName) {
    if (!confirm(`Send mandatory review form to ${userName}? Their dashboard will stop displaying immediately until they submit.`)) return;
    try {
        const res = await fetch('/api/forms/send-user', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentToken}` },
            body: JSON.stringify({ userId })
        });
        const data = await res.json();
        if (res.ok) {
            showToast('Form Sent', data.message);
            loadAdminForms();
            loadAdminUsers();
        } else {
            showToast('Error', data.error || 'Failed to send review form', 'danger');
        }
    } catch (e) {
        showToast('Error', 'Network error', 'danger');
    }
}

async function adminSendReviewFormToAll() {
    if (!confirm('Are you sure you want to send the mandatory review form to ALL approved operators? Their dashboards will stop displaying immediately until each operator completes and submits the form.')) return;
    try {
        const res = await fetch('/api/forms/send-all', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentToken}` }
        });
        const data = await res.json();
        if (res.ok) {
            showToast('Forms Dispatched', data.message);
            loadAdminForms();
            loadAdminUsers();
        } else {
            showToast('Error', data.error || 'Failed to dispatch forms', 'danger');
        }
    } catch (e) {
        showToast('Error', 'Network error', 'danger');
    }
}

async function adminCancelReviewForm(userId) {
    if (!confirm('Cancel the review form requirement for this operator? Their dashboard will immediately resume displaying.')) return;
    try {
        const res = await fetch('/api/forms/cancel-user', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentToken}` },
            body: JSON.stringify({ userId })
        });
        const data = await res.json();
        if (res.ok) {
            showToast('Requirement Cancelled', data.message);
            loadAdminForms();
            loadAdminUsers();
        } else {
            showToast('Error', data.error || 'Failed to cancel requirement', 'danger');
        }
    } catch (e) {
        showToast('Error', 'Network error', 'danger');
    }
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
        'user-bulk-updations': 'Bulk Updations',
        'user-banned-accounts': 'My Banned Accounts',
        'user-classified-accounts': 'Old & New Accounts',
        'user-rewards': 'Available Rewards & Eligibility',
        'user-requests': 'My Request Center',
        'user-downloads': 'Authorized Reports Download'
    };
    document.getElementById('current-view-title').textContent = titleMap[pageId] || 'User Dashboard';

    if (pageId === 'user-overview') loadUserOverview();
    if (pageId === 'user-active-accounts') {
        loadUserAccounts();
        loadUserEditingStatus();
    }
    if (pageId === 'user-bulk-updations') {
        loadUserBulkUpdations();
        loadUserEditingStatus();
    }
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

async function loadUserEditingStatus() {
    try {
        const res = await fetch('/api/accounts/editing-status', {
            headers: { 'Authorization': `Bearer ${currentToken}` }
        });
        if (!res.ok) return;
        const status = await res.json();
        window._userEditingStatus = status;

        const pill = document.getElementById('user-editing-pill');
        if (pill) {
            pill.style.display = 'inline-block';
            pill.className = `badge ${status.badgeClass || (status.isWithinWindow ? 'badge-active' : 'badge-pending')}`;
            pill.innerHTML = `<i class="fa-solid fa-clock"></i> ${status.statusText}`;
        }

        const btnAdd = document.getElementById('btn-user-add-account');
        if (btnAdd) {
            const canAdd = status.canAddAccounts || status.canAdd || status.isWithinWindow || status.isTemporaryWindow;
            if (!canAdd) {
                btnAdd.classList.add('opacity-75');
                btnAdd.title = 'Account addition is locked in Read-Only mode. Submit a request to add accounts.';
            } else {
                btnAdd.classList.remove('opacity-75');
                btnAdd.title = '';
            }
        }

        const btnExcel = document.getElementById('btn-user-upload-excel');
        if (btnExcel) {
            const canImport = status.canImportExcel || status.canAddAccounts || status.canAdd || status.isWithinWindow || status.isTemporaryWindow;
            if (!canImport) {
                btnExcel.classList.add('opacity-75');
                btnExcel.title = 'Spreadsheet import is locked in Read-Only mode. Submit a request to import accounts.';
            } else {
                btnExcel.classList.remove('opacity-75');
                btnExcel.title = '';
            }
        }

        const btnPts = document.getElementById('btn-user-update-points');
        if (btnPts) {
            if (status.isReadOnly || !status.canUpdatePoints) {
                btnPts.innerHTML = `<i class="fa-solid fa-lock"></i> Request Points Window`;
                btnPts.className = 'btn secondary-btn';
                btnPts.onclick = () => openRequestPointsModal();
            } else {
                btnPts.innerHTML = `<i class="fa-solid fa-bolt"></i> Points Update Active`;
                btnPts.className = 'btn primary-btn';
            }
        }
    } catch (e) {
        console.error('Failed to load editing status:', e);
    }
}

function handleUserAddAccount() {
    const status = window._userEditingStatus;
    const canAdd = !status || status.canAddAccounts || status.canAdd || status.isWithinWindow || status.isTemporaryWindow;
    if (!canAdd && status && status.isReadOnly) {
        if (confirm('Account addition is currently locked in Read-Only mode.\n\nWould you like to submit an access request to the Administrator now?')) {
            openCreateUserRequestModal();
            document.getElementById('req-category').value = 'account_correction';
            document.getElementById('req-subject').value = 'Request Permission to Add Accounts';
            document.getElementById('req-message').value = 'My account is currently in Read-Only mode. Please grant a temporary window to register new accounts.';
        }
        return;
    }
    openCreateAccountModal();
}

function handleUserUploadExcel() {
    const status = window._userEditingStatus;
    const canImport = !status || status.canImportExcel || status.canAddAccounts || status.canAdd || status.isWithinWindow || status.isTemporaryWindow;
    if (!canImport && status && status.isReadOnly) {
        if (confirm('Spreadsheet import is currently locked in Read-Only mode.\n\nWould you like to submit an access request to the Administrator now?')) {
            openCreateUserRequestModal();
            document.getElementById('req-category').value = 'account_correction';
            document.getElementById('req-subject').value = 'Request Permission for Excel Import';
            document.getElementById('req-message').value = 'My account is currently in Read-Only mode. Please grant permission to import accounts via spreadsheet.';
        }
        return;
    }
    openUploadExcelModal();
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
                    <td><strong>${formatProfileNo(a.profile_no)}</strong></td>
                    <td>
                        <div style="font-weight: 600; color: #fff;">${escapeHtml(a.email)}</div>
                        ${a.recovery_email ? `<div class="text-secondary" style="font-size: 0.78rem;">Alt: ${escapeHtml(a.recovery_email)}</div>` : ''}
                    </td>
                    <td class="text-secondary">${a.server || '-'}</td>
                    <td style="color: var(--secondary-color); font-weight: 700;">${a.current_points.toLocaleString()}</td>
                    <td><span class="badge badge-primary">${(a.classification || 'new').toUpperCase()}</span></td>
                    <td><span class="badge badge-active">ACTIVE</span></td>
                    <td>
                        <button class="btn secondary-btn" style="padding: 0.35rem 0.65rem; font-size: 0.78rem;" onclick="openAccountDetailsPage(${a.id})">
                            <i class="fa-solid fa-circle-info"></i> Details
                        </button>
                    </td>
                </tr>
            `).join('');
    }

    const bannedBody = document.getElementById('user-banned-accounts-body');
    if (bannedBody) {
        bannedBody.innerHTML = bannedList.length === 0 ? '<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">No banned accounts.</td></tr>' :
            bannedList.map(a => `
                <tr>
                    <td><strong>${formatProfileNo(a.profile_no)}</strong></td>
                    <td>${escapeHtml(a.email)}</td>
                    <td class="text-secondary">${a.server || '-'}</td>
                    <td>${a.current_points.toLocaleString()}</td>
                    <td><span class="badge badge-banned">BANNED</span></td>
                    <td>
                        <button class="btn secondary-btn" style="padding: 0.35rem 0.65rem; font-size: 0.78rem;" onclick="openAccountDetailsPage(${a.id})">
                            <i class="fa-solid fa-circle-info"></i> Details
                        </button>
                    </td>
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
                <td><strong>${formatProfileNo(a.profile_no)}</strong></td>
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

// Manuals retired per platform instruction
function openManualModal() {}
function switchManualTab() {}

// =============================================================================
// USER BULK UPDATIONS CONTROLLER
// =============================================================================
async function loadUserBulkUpdations() {
    try {
        const res = await fetch('/api/accounts', {
            headers: { 'Authorization': `Bearer ${currentToken}` }
        });
        if (!res.ok) return;
        const accounts = await res.json();
        window._userBulkAccounts = accounts || [];
        filterUserBulkTable();
    } catch (e) {
        console.error('Failed to load accounts for bulk updations:', e);
    }
}

function filterUserBulkTable() {
    const search = (document.getElementById('user-bulk-search')?.value || '').toLowerCase().trim();
    const accounts = window._userBulkAccounts || [];
    
    const filtered = accounts.filter(a => {
        if (!search) return true;
        const em = (a.email || '').toLowerCase();
        const profStr = formatProfileNo(a.profile_no);
        const pNum = String(a.profile_no || '');
        return em.includes(search) || profStr.includes(search) || pNum === search;
    });

    const countPill = document.getElementById('user-bulk-count-pill');
    if (countPill) countPill.textContent = `${filtered.length} account${filtered.length === 1 ? '' : 's'}`;

    const body = document.getElementById('user-bulk-updations-body');
    if (!body) return;

    if (filtered.length === 0) {
        body.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 2rem;">No accounts found.</td></tr>`;
        return;
    }

    body.innerHTML = filtered.map(a => {
        const lastUpdatedText = a.last_points_updated_at 
            ? new Date(a.last_points_updated_at).toLocaleString() 
            : (a.lastUpdated ? new Date(a.lastUpdated).toLocaleString() : '8/19/2026, 2:13:07 PM');

        return `
            <tr style="border-bottom: 1px solid rgba(255, 255, 255, 0.05);">
                <td style="font-weight: 700; color: #fff; font-size: 0.95rem;">${a.profile_no !== null && a.profile_no !== undefined ? a.profile_no : '-'}</td>
                <td style="font-family: monospace; color: #e2e8f0; font-size: 0.88rem;">${escapeHtml(a.email)}</td>
                <td style="font-weight: 700; color: #fff; font-size: 0.92rem;">${(a.current_points || 0).toLocaleString()} pts</td>
                <td>
                    <div style="display: inline-flex; align-items: center; gap: 0.5rem;">
                        <input type="number" id="inline-points-${a.id}" placeholder="New points" 
                               style="width: 110px; padding: 0.35rem 0.6rem; background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(255, 255, 255, 0.15); border-radius: 6px; color: #fff; font-size: 0.82rem;" 
                               onkeydown="if(event.key === 'Enter') submitInlinePointUpdate(${a.id})">
                        <button class="btn primary-btn" style="background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); border: none; padding: 0.35rem 0.85rem; font-size: 0.8rem; border-radius: 6px; font-weight: 600; cursor: pointer;" 
                                onclick="submitInlinePointUpdate(${a.id})">
                            Update
                        </button>
                    </div>
                </td>
                <td style="color: #94a3b8; font-size: 0.82rem;">${lastUpdatedText}</td>
            </tr>
        `;
    }).join('');
}

async function submitInlinePointUpdate(accountId) {
    const input = document.getElementById(`inline-points-${accountId}`);
    if (!input) return;
    const val = input.value.trim();
    if (val === '' || isNaN(parseInt(val))) {
        showToast('Validation Error', 'Please enter a valid points number.', 'danger');
        return;
    }

    const newPoints = parseInt(val);
    try {
        const res = await fetch(`/api/accounts/${accountId}/points`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentToken}`
            },
            body: JSON.stringify({ points: newPoints, reason: 'Bulk Updations Page' })
        });

        const data = await res.json();
        if (res.ok) {
            showToast('Points Updated', data.message || 'Points updated successfully!');
            input.value = '';
            // Refresh bulk table and overview
            loadUserBulkUpdations();
            loadUserOverview();
        } else {
            if (res.status === 403) {
                // Read-Only mode prompt: offer to request access
                showToast('Read-Only Mode', data.error || 'You are in Read-Only mode.', 'warning');
                openRequestPointsModal();
            } else {
                showToast('Error', data.error || 'Failed to update points.', 'danger');
            }
        }
    } catch (e) {
        showToast('Network Error', 'Could not reach server to update points.', 'danger');
    }
}

function openBulkPointsExcelModal() {
    const fileInput = document.getElementById('bulk-points-excel-file');
    if (fileInput) fileInput.value = '';
    openModal('modal-bulk-points-excel');
}

async function submitBulkPointsExcel(e) {
    e.preventDefault();
    const fileInput = document.getElementById('bulk-points-excel-file');
    if (!fileInput || !fileInput.files[0]) {
        showToast('File Required', 'Please select a spreadsheet file (.xlsx, .csv).', 'warning');
        return;
    }

    const formData = new FormData();
    formData.append('file', fileInput.files[0]);

    const submitBtn = document.getElementById('btn-submit-bulk-excel');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Processing...';
    }

    try {
        const res = await fetch('/api/accounts/bulk-points-excel', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${currentToken}`
            },
            body: formData
        });

        const data = await res.json();
        if (res.ok) {
            closeModal('modal-bulk-points-excel');
            showToast('Success', data.message || 'Bulk points updated successfully!');
            loadUserBulkUpdations();
            loadUserOverview();
        } else {
            if (res.status === 403) {
                closeModal('modal-bulk-points-excel');
                showToast('Read-Only Mode', data.error || 'Points updating is currently locked.', 'warning');
                openRequestPointsModal();
            } else {
                showToast('Upload Error', data.error || 'Failed to update points from file.', 'danger');
            }
        }
    } catch (err) {
        showToast('Network Error', 'Failed to upload spreadsheet.', 'danger');
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> Upload & Update';
        }
    }
}

function downloadPointsExcelTemplate() {
    const csvContent = "data:text/csv;charset=utf-8," +
        "Profile No,Email,Points\n" +
        "2,kuwaitacc1@outlook.com,3500\n" +
        "3,samsingaroi2@gmail.com,4200\n" +
        "4,gujjularam736@gmail.com,3000\n";
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "PointPulse_Bulk_Points_Template.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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

function openRequestPointsModal(accId, email) {
    openCreateUserRequestModal();
    const catSelect = document.getElementById('req-category');
    if (catSelect) catSelect.value = 'points_update';
    const subjInput = document.getElementById('req-subject');
    if (subjInput) subjInput.value = email ? `Request Points Update Window (${email})` : 'Request Points Update Window';
    const msgInput = document.getElementById('req-message');
    if (msgInput) msgInput.value = email 
        ? `Requesting temporary write permission from administrator to update points for account: ${email} (Account ID: ${accId || '-'}).`
        : 'Requesting a temporary access window from administrator to update points on assigned accounts.';
}

function openPointsUpdateModal(accId, email, currentPts) {
    if (currentUser.role !== 'admin') {
        const canUpdate = (currentUser.permissions && currentUser.permissions.includes('update_points')) || 
                          (window._userEditingStatus && window._userEditingStatus.canUpdatePoints);
        if (!canUpdate) {
            if (confirm(`Points updating is currently locked in Read-Only mode.\n\nWould you like to request a temporary editing window from the Administrator now to update points for ${email}?`)) {
                openRequestPointsModal(accId, email);
            }
            return;
        }
    }
    document.getElementById('pu-account-id').value = accId;
    document.getElementById('pu-account-info').textContent = `Updating points for: ${email} (Current: ${Number(currentPts).toLocaleString()} pts)`;
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
            showToast('Points Updated', `Account points updated to ${Number(data.newPoints).toLocaleString()} pts.`);
            if (currentUser.role === 'admin') loadAllAccounts();
            else {
                loadUserAccounts();
                loadUserEditingStatus();
            }
        } else {
            showToast('Denied', data.error || 'You do not have permission to update points. Submit a permission request.', 'danger');
            if (data.code === 'READ_ONLY' && confirm(`${data.error}\n\nWould you like to submit an access request to the Administrator now?`)) {
                closeModal('modal-points-update');
                openRequestPointsModal(accId);
            }
        }
    } catch (e) {
        showToast('Error', 'Update failed', 'danger');
    }
}

function toggleTheme() {
    document.body.classList.toggle('light-theme');
}

// Check for Google OAuth hash in URL upon redirect
handleGoogleAuthHash();

// Run initial session check & load authentication configuration
loadAuthConfig();
checkSession();

window.addEventListener('load', () => {
    if (googleClientId) initializeGoogleGSI();
});

// Periodic retry to ensure GSI binds as soon as Google library script downloads
let gsiRetryCount = 0;
const gsiCheckInterval = setInterval(() => {
    gsiRetryCount++;
    if (window.google && google.accounts && googleClientId && !isGoogleGSIInitialized) {
        initializeGoogleGSI();
        clearInterval(gsiCheckInterval);
    }
    if (gsiRetryCount > 25) clearInterval(gsiCheckInterval);
}, 300);
