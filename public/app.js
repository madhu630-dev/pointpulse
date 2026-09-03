document.addEventListener('DOMContentLoaded', () => {
    // --- State ---
    let token = localStorage.getItem('token');
    let userEmail = localStorage.getItem('email');
    let userRole = localStorage.getItem('role') || 'admin';
    let accountsData = [];
    let currentFilteredActiveAccounts = [];
    let inventoryData = [];
    let currentInventoryTab = 'sold';
    let whatsappUsersData = [];
    let socket = null;

    // --- DOM Elements ---
    const loginView = document.getElementById('login-view');
    const appLayout = document.getElementById('app-layout');
    
    // Auth DOM
    const authSubtitle = document.getElementById('auth-subtitle');
    const authErrorBox = document.getElementById('auth-error-box');
    const authErrorMsg = document.getElementById('auth-error-msg');
    const loginEmailInput = document.getElementById('login-email');
    const loginPasswordInput = document.getElementById('login-password');
    const togglePasswordBtn = document.getElementById('toggle-password');
    const rememberMeCheckbox = document.getElementById('remember-me');
    const loginBtn = document.getElementById('login-btn');
    const registerBtn = document.getElementById('register-btn');
    const loginSpinner = document.getElementById('login-spinner');
    const registerSpinner = document.getElementById('register-spinner');
    const toggleAuthLink = document.getElementById('toggle-auth');
    const logoutBtn = document.getElementById('logout-btn');
    const userDisplay = document.getElementById('user-display');
    
    // Nav
    const navItems = document.querySelectorAll('.nav-item[data-target]');
    const pageViews = document.querySelectorAll('.page-view');
    const themeToggle = document.getElementById('theme-toggle');
    const exportCsvBtn = document.getElementById('export-csv-btn');
    const exportPdfBtn = document.getElementById('export-pdf-btn');

    // Download Center DOM
    const dlTypeRadios = document.querySelectorAll('input[name="dl-account-type"]');
    const dlStatusFilter = document.getElementById('dl-status-filter');
    const downloadMatchCount = document.getElementById('download-match-count');
    const dlDetailedBadge = document.getElementById('dl-detailed-badge');
    const btnDlDetailedXlsx = document.getElementById('btn-dl-detailed-xlsx');
    const btnDlDetailedPdf = document.getElementById('btn-dl-detailed-pdf');
    const btnDlDetailedCsv = document.getElementById('btn-dl-detailed-csv');
    const btnDlPointsXlsx = document.getElementById('btn-dl-points-xlsx');
    const btnDlPointsPdf = document.getElementById('btn-dl-points-pdf');
    const btnDlPointsCsv = document.getElementById('btn-dl-points-csv');
    const downloadPreviewBody = document.getElementById('download-preview-body');
    const dlPreviewStatusText = document.getElementById('dl-preview-status-text');

    // WhatsApp Bot & Access DOM
    const btnOpenAddWaUser = document.getElementById('btn-open-add-wa-user');
    const waUsersCountBadge = document.getElementById('wa-users-count-badge');
    const waUsersTableBody = document.getElementById('wa-users-table-body');
    const simPhoneSelect = document.getElementById('sim-phone-select');
    const simChatBox = document.getElementById('sim-chat-box');
    const simForm = document.getElementById('sim-form');
    const simInput = document.getElementById('sim-input');
    const btnSimSend = document.getElementById('btn-sim-send');

    // WhatsApp Direct Client / QR DOM
    const btnStartWa = document.getElementById('btn-start-wa');
    const btnDisconnectWa = document.getElementById('btn-disconnect-wa');
    const waConnectionBadge = document.getElementById('wa-connection-badge');
    const waQrBox = document.getElementById('wa-qr-box');
    const waQrImg = document.getElementById('wa-qr-img');
    const waQrLoading = document.getElementById('wa-qr-loading');
    
    // WhatsApp User Modal DOM
    const waUserModal = document.getElementById('whatsapp-user-modal');
    const waModalTitle = document.getElementById('wa-modal-title');
    const waUserIdInput = document.getElementById('wa-user-id');
    const waUserNameInput = document.getElementById('wa-user-name');
    const waUserPhoneInput = document.getElementById('wa-user-phone');
    const waPermPointsUpdate = document.getElementById('wa-perm-points-update');
    const waPermViewPoints = document.getElementById('wa-perm-view-points');
    const waUserIsActive = document.getElementById('wa-user-is-active');
    const btnSaveWaUser = document.getElementById('btn-save-wa-user');
    
    // Upload Modal
    const openUploadModalBtn = document.getElementById('open-upload-modal-btn');
    const uploadModal = document.getElementById('upload-modal');
    const fileUpload = document.getElementById('file-upload');
    const freshUploadCheckbox = document.getElementById('fresh-upload-checkbox');
    const confirmUploadBtn = document.getElementById('confirm-upload-btn');
    
    // Dashboard Sections
    const overviewStatsContainer = document.getElementById('overview-stats-container');
    const readyRedeemContainer = document.getElementById('ready-redeem-container');
    const bucketsContainer = document.getElementById('buckets-container');

    // Inventory DOM
    const inventoryContainer = document.getElementById('inventory-container');
    const tabSold = document.getElementById('tab-sold');
    const tabUnsold = document.getElementById('tab-unsold');
    
    // Tables & Filters
    const activeAccountsBody = document.getElementById('active-accounts-body');
    const bannedAccountsBody = document.getElementById('banned-accounts-body');
    const updationsAccountsBody = document.getElementById('updations-accounts-body');
    const searchActiveInput = document.getElementById('search-active');
    const searchBannedInput = document.getElementById('search-banned');
    const filterSort = document.getElementById('filter-sort');
    const filterPoints = document.getElementById('filter-points');
    const filterServer = document.getElementById('filter-server');
    const filterEligibility = document.getElementById('filter-eligibility');
    
    // Modals
    const editModal = document.getElementById('edit-modal');
    const redeemModal = document.getElementById('redeem-modal');
    const bucketModal = document.getElementById('bucket-modal');
    const shareReportModal = document.getElementById('share-report-modal');
    const singleShareModal = document.getElementById('single-share-modal');
    const shareTotalReportBtn = document.getElementById('share-total-report-btn');
    const closeBtns = document.querySelectorAll('.close-modal');
    
    // Create Modal Elements
    const createModal = document.getElementById('create-modal');
    const openCreateModalBtn = document.getElementById('open-create-modal-btn');
    const createProfile = document.getElementById('create-profile');
    const createEmail = document.getElementById('create-email');
    const createServer = document.getElementById('create-server');
    const createProton = document.getElementById('create-proton');
    const createPassword = document.getElementById('create-password');
    const createAltEmail = document.getElementById('create-alt-email');
    const createPoints = document.getElementById('create-points');
    const createNotes = document.getElementById('create-notes');
    const createStatus = document.getElementById('create-status');
    const saveCreateBtn = document.getElementById('save-create-btn');

    // Edit Modal Elements
    const editId = document.getElementById('edit-id');
    const editProfile = document.getElementById('edit-profile');
    const editEmail = document.getElementById('edit-email');
    const editServer = document.getElementById('edit-server');
    const editProton = document.getElementById('edit-proton');
    const editPassword = document.getElementById('edit-password');
    const editAltEmail = document.getElementById('edit-alt-email');
    const editNotes = document.getElementById('edit-notes');
    const editStatus = document.getElementById('edit-status');
    const saveEditBtn = document.getElementById('save-edit-btn');

    // Redeem Modal Elements
    const redeemUserId = document.getElementById('redeem-user-id');
    const redeemUserEmail = document.getElementById('redeem-user-email');
    const redeemUserServer = document.getElementById('redeem-user-server');
    const redeemEmailDisplay = document.getElementById('redeem-email-display');
    const redeemItemSelect = document.getElementById('redeem-item-select');
    const redeemDate = document.getElementById('redeem-date');
    const redeemCodeInput = document.getElementById('redeem-code');
    const redeemStatusSelect = document.getElementById('redeem-status');
    const confirmRedeemBtn = document.getElementById('confirm-redeem-btn');
    const whatsappBtn = document.getElementById('whatsapp-btn');

    // Share Report Elements
    const openShareReportBtn = document.getElementById('open-share-report-btn');
    const reportTextArea = document.getElementById('report-text-area');
    const copyReportBtn = document.getElementById('copy-report-btn');
    const emailReportBtn = document.getElementById('email-report-btn');
    const whatsappReportBtn = document.getElementById('whatsapp-report-btn');

    const toast = document.getElementById('toast');
    let isLoginMode = true;

    // Phase 3: Lock Screen State
    const lockScreen = document.getElementById('lock-screen');
    const pinInputs = document.querySelectorAll('.pin-box');
    const lockError = document.getElementById('lock-error');
    const copyEmailsBtn = document.getElementById('copy-emails-btn');
    let inactivityTimer;
    const LOCK_TIMEOUT_MS = 5 * 60 * 1000;

    // --- Initialization ---
    if (token) {
        showDashboard();
    } else {
        showLogin();
    }

    redeemDate.valueAsDate = new Date();

    function initSocket() {
        if (typeof io !== 'undefined' && !socket) {
            socket = io();
            try {
                const payload = JSON.parse(atob(token.split('.')[1]));
                socket.emit('join', payload.admin_id);
            } catch(e) {}

            socket.on('notification', (data) => {
                showToast(data.title, data.message, data.type);
                fetchData();
            });
        }
    }

    // --- Event Listeners ---
    if (togglePasswordBtn) {
        togglePasswordBtn.addEventListener('click', () => {
            const type = loginPasswordInput.getAttribute('type') === 'password' ? 'text' : 'password';
            loginPasswordInput.setAttribute('type', type);
            togglePasswordBtn.className = type === 'password' ? 'fa-solid fa-eye' : 'fa-solid fa-eye-slash';
        });
    }

    loginBtn.addEventListener('click', handleLogin);
    registerBtn.addEventListener('click', handleRegister);
    toggleAuthLink.addEventListener('click', (e) => {
        e.preventDefault();
        isLoginMode = !isLoginMode;
        authErrorBox.classList.add('hidden');
        if (isLoginMode) {
            loginBtn.classList.remove('hidden');
            registerBtn.classList.add('hidden');
            authSubtitle.innerText = 'Sign in to your account';
            toggleAuthLink.innerHTML = 'Need an account? <span style="color: var(--primary-color);">Register</span>';
        } else {
            loginBtn.classList.add('hidden');
            registerBtn.classList.remove('hidden');
            authSubtitle.innerText = 'Create a new admin account';
            toggleAuthLink.innerHTML = 'Already have an account? <span style="color: var(--primary-color);">Sign In</span>';
        }
    });

    logoutBtn.addEventListener('click', handleLogout);
    themeToggle.addEventListener('click', toggleTheme);
    
    // Exports
    if (exportCsvBtn) exportCsvBtn.addEventListener('click', () => downloadExport('csv'));
    if (exportPdfBtn) exportPdfBtn.addEventListener('click', () => downloadExport('pdf'));

    // Download Center Listeners
    dlTypeRadios.forEach(r => r.addEventListener('change', renderDownloadsSection));
    if (dlStatusFilter) dlStatusFilter.addEventListener('change', renderDownloadsSection);

    if (btnDlDetailedXlsx) btnDlDetailedXlsx.addEventListener('click', () => downloadDetailed('xlsx'));
    if (btnDlDetailedPdf) btnDlDetailedPdf.addEventListener('click', () => downloadDetailed('pdf'));
    if (btnDlDetailedCsv) btnDlDetailedCsv.addEventListener('click', () => downloadDetailed('csv'));
    if (btnDlPointsXlsx) btnDlPointsXlsx.addEventListener('click', () => downloadPointsList('xlsx'));
    if (btnDlPointsPdf) btnDlPointsPdf.addEventListener('click', () => downloadPointsList('pdf'));
    if (btnDlPointsCsv) btnDlPointsCsv.addEventListener('click', () => downloadPointsList('csv'));

    // WhatsApp Bot Listeners
    if (btnOpenAddWaUser) btnOpenAddWaUser.addEventListener('click', openAddWaUserModal);
    if (btnSaveWaUser) btnSaveWaUser.addEventListener('click', saveWaUser);
    if (simForm) simForm.addEventListener('submit', (e) => { e.preventDefault(); sendSimMessage(); });
    if (btnSimSend) btnSimSend.addEventListener('click', sendSimMessage);
    if (btnStartWa) btnStartWa.addEventListener('click', startWhatsAppClient);
    if (btnDisconnectWa) btnDisconnectWa.addEventListener('click', disconnectWhatsAppClient);

    navItems.forEach(btn => btn.addEventListener('click', (e) => {
        navItems.forEach(b => b.classList.remove('active'));
        const targetId = e.currentTarget.dataset.target;
        e.currentTarget.classList.add('active');
        
        pageViews.forEach(page => {
            if (page.id === targetId) {
                page.classList.add('active');
                page.classList.remove('hidden');
            } else {
                page.classList.remove('active');
                page.classList.add('hidden');
            }
        });

        if (targetId === 'page-downloads') {
            renderDownloadsSection();
        } else if (targetId === 'page-whatsapp') {
            fetchWhatsAppUsers();
            checkWhatsAppClientStatus();
        }
    }));

    openUploadModalBtn.addEventListener('click', () => uploadModal.classList.remove('hidden'));
    confirmUploadBtn.addEventListener('click', handleFileUpload);
    
    // Filters with Debounce for Search
    let searchTimeout;
    const triggerActiveRender = () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            renderAccountsTable('active', activeAccountsBody, searchActiveInput.value);
        }, 300);
    };
    searchActiveInput.addEventListener('input', triggerActiveRender);
    if(filterSort) filterSort.addEventListener('change', triggerActiveRender);
    if(filterPoints) filterPoints.addEventListener('change', triggerActiveRender);
    if(filterEligibility) filterEligibility.addEventListener('change', triggerActiveRender);

    let searchBannedTimeout;
    searchBannedInput.addEventListener('input', () => {
        clearTimeout(searchBannedTimeout);
        searchBannedTimeout = setTimeout(() => {
            renderAccountsTable('banned', bannedAccountsBody, searchBannedInput.value);
        }, 300);
    });
    
    closeBtns.forEach(btn => btn.addEventListener('click', () => {
        if(createModal) createModal.classList.add('hidden');
        editModal.classList.add('hidden');
        redeemModal.classList.add('hidden');
        bucketModal.classList.add('hidden');
        uploadModal.classList.add('hidden');
        if(shareReportModal) shareReportModal.classList.add('hidden');
    }));

    const backToActiveBtn = document.getElementById('back-to-active-btn');
    if (backToActiveBtn) backToActiveBtn.addEventListener('click', () => {
        document.querySelector('[data-target="page-active"]').click();
    });

    function parseServerDetails(serverStr) {
        if (!serverStr) return '-';
        const states = { 'AZ': 'Arizona', 'WA': 'Washington', 'MA': 'Massachusetts', 'CA': 'California', 'NY': 'New York', 'TX': 'Texas', 'FL': 'Florida' };
        const parts = serverStr.split('-');
        if (parts.length === 2) {
            const region = parts[0];
            const subParts = parts[1].split('#');
            const stateAbbr = subParts[0];
            const number = subParts[1] ? `#${subParts[1]}` : '';
            const stateFull = states[stateAbbr] || stateAbbr;
            return `${region} - ${stateFull} (${number})`;
        }
        return serverStr;
    }

    saveEditBtn.addEventListener('click', saveAccountEdit);

    if (openCreateModalBtn) openCreateModalBtn.addEventListener('click', () => {
        if (createProfile) createProfile.value = '';
        if (createEmail) createEmail.value = '';
        if (createServer) createServer.value = '';
        if (createProton) createProton.value = '';
        if (createPassword) createPassword.value = '';
        if (createAltEmail) createAltEmail.value = '';
        if (createPoints) createPoints.value = '0';
        if (createNotes) createNotes.value = '';
        if (createStatus) createStatus.value = 'active';
        if (createModal) createModal.classList.remove('hidden');
    });

    if (saveCreateBtn) saveCreateBtn.addEventListener('click', createAccount);

    async function createAccount() {
        const email = createEmail.value.trim();
        if (!email) {
            showToast('Error', 'Email is required', 'danger');
            return;
        }

        const payload = {
            profile_no: createProfile.value ? parseInt(createProfile.value) : null,
            email: email,
            server: createServer.value.trim(),
            proton_email: createProton.value.trim(),
            password: createPassword.value.trim(),
            alternative_email: createAltEmail.value.trim(),
            initial_points: parseInt(createPoints.value) || 0,
            notes: createNotes.value.trim(),
            status: createStatus.value
        };

        saveCreateBtn.disabled = true;
        saveCreateBtn.innerText = 'Creating...';

        try {
            const res = await fetch('/api/accounts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify(payload)
            });

            if (res.ok) {
                showToast('Success', 'Profile created successfully', 'success');
                createModal.classList.add('hidden');
                fetchData();
            } else {
                const data = await res.json();
                showToast('Error', data.error || 'Failed to create profile', 'danger');
            }
        } catch (error) {
            console.error("Create Profile Error:", error);
            showToast('Error', 'Network error while creating profile', 'danger');
        } finally {
            saveCreateBtn.disabled = false;
            saveCreateBtn.innerText = 'Create Profile';
        }
    }

    confirmRedeemBtn.addEventListener('click', confirmRedemption);
    whatsappBtn.addEventListener('click', shareToWhatsApp);
    
    // Share Report Event Listeners
    if (openShareReportBtn) openShareReportBtn.addEventListener('click', generateShareReport);
    if (copyReportBtn) copyReportBtn.addEventListener('click', copyReportText);
    if (emailReportBtn) emailReportBtn.addEventListener('click', emailReportText);
    if (whatsappReportBtn) whatsappReportBtn.addEventListener('click', whatsappReportText);

    if (tabSold) tabSold.addEventListener('click', () => { currentInventoryTab = 'sold'; renderInventory(); updateTabStyles(); });
    if (tabUnsold) tabUnsold.addEventListener('click', () => { currentInventoryTab = 'unsold'; renderInventory(); updateTabStyles(); });

    function updateTabStyles() {
        if(currentInventoryTab === 'sold') {
            tabSold.className = 'btn primary-btn';
            tabUnsold.className = 'btn secondary-btn';
        } else {
            tabSold.className = 'btn secondary-btn';
            tabUnsold.className = 'btn primary-btn';
        }
    }

    // Phase 3: Lock Screen Timer
    function resetTimer() {
        if (!token || !lockScreen) return;
        clearTimeout(inactivityTimer);
        inactivityTimer = setTimeout(showLockScreen, LOCK_TIMEOUT_MS);
    }
    window.addEventListener('mousemove', resetTimer);
    window.addEventListener('keydown', resetTimer);
    window.addEventListener('click', resetTimer);
    window.addEventListener('scroll', resetTimer);

    // Phase 3: Lock Screen PIN logic
    pinInputs.forEach((input, index) => {
        input.addEventListener('input', (e) => {
            if(e.target.value && index < pinInputs.length - 1) pinInputs[index+1].focus();
            checkPin();
        });
        input.addEventListener('keydown', (e) => {
            if(e.key === 'Backspace' && !e.target.value && index > 0) pinInputs[index-1].focus();
        });
    });

    function checkPin() {
        const pin = Array.from(pinInputs).map(i => i.value).join('');
        if (pin.length === 4) {
            if (pin === '0000') {
                lockScreen.classList.add('hidden');
                pinInputs.forEach(i => i.value = '');
                lockError.classList.add('hidden');
                resetTimer();
            } else {
                lockError.classList.remove('hidden');
                pinInputs.forEach(i => i.value = '');
                pinInputs[0].focus();
            }
        }
    }

    function showLockScreen() {
        if (!token) return;
        lockScreen.classList.remove('hidden');
        pinInputs.forEach(i => i.value = '');
        lockError.classList.add('hidden');
        pinInputs[0].focus();
    }

    // Phase 3: Keyboard Shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key.toLowerCase() === 'f') {
            e.preventDefault();
            searchActiveInput.focus();
        }
        if (e.ctrlKey && e.key.toLowerCase() === 'u') {
            e.preventDefault();
            if (userRole === 'admin') uploadModal.classList.remove('hidden');
        }
        if (e.key === 'Enter') {
            if (!editModal.classList.contains('hidden')) saveAccountEdit();
            if (!redeemModal.classList.contains('hidden')) confirmRedemption();
        }
    });

    // --- Auth Functions ---
    function showLogin() {
        loginView.classList.remove('hidden');
        appLayout.classList.add('hidden');
        if (socket) { socket.disconnect(); socket = null; }
        clearTimeout(inactivityTimer);
    }

    function showDashboard() {
        loginView.classList.add('hidden');
        appLayout.classList.remove('hidden');
        userDisplay.innerText = `${userEmail} (${userRole})`;
        
        if (userRole === 'viewer') {
            openUploadModalBtn.classList.add('hidden');
            if (exportCsvBtn) exportCsvBtn.classList.add('hidden');
            if (exportPdfBtn) exportPdfBtn.classList.add('hidden');
        } else {
            openUploadModalBtn.classList.remove('hidden');
            if (exportCsvBtn) exportCsvBtn.classList.remove('hidden');
            if (exportPdfBtn) exportPdfBtn.classList.remove('hidden');
        }

        initSocket();
        fetchData();
    }

    function showAuthError(msg) {
        authErrorMsg.innerText = msg;
        authErrorBox.classList.remove('hidden');
    }

    function setBtnLoading(btn, spinner, isLoading) {
        if (isLoading) {
            btn.disabled = true;
            spinner.classList.remove('hidden');
        } else {
            btn.disabled = false;
            spinner.classList.add('hidden');
        }
    }

    async function handleLogin() {
        const email = loginEmailInput.value.trim();
        const password = loginPasswordInput.value;
        authErrorBox.classList.add('hidden');

        if (!email) return showAuthError('Please enter your email address');
        if (!password) return showAuthError('Please enter your password');

        setBtnLoading(loginBtn, loginSpinner, true);
        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            const data = await res.json();
            if (res.ok && data.token) {
                token = data.token;
                userEmail = data.email;
                userRole = data.role || 'admin';
                
                if (rememberMeCheckbox && rememberMeCheckbox.checked) {
                    localStorage.setItem('token', token);
                    localStorage.setItem('email', userEmail);
                    localStorage.setItem('role', userRole);
                } else {
                    // Only store temporarily if remember me not checked (using session storage logic, but local storage works for MVP)
                    localStorage.setItem('token', token);
                    localStorage.setItem('email', userEmail);
                    localStorage.setItem('role', userRole);
                }
                
                showDashboard();
            } else {
                showAuthError(data.error || 'Incorrect email or password');
            }
        } catch (e) {
            showAuthError('Network error. Please try again later.');
        } finally {
            setBtnLoading(loginBtn, loginSpinner, false);
        }
    }

    async function handleRegister() {
        const email = loginEmailInput.value.trim();
        const password = loginPasswordInput.value;
        authErrorBox.classList.add('hidden');

        if (!email) return showAuthError('Please enter an email address');
        if (!password) return showAuthError('Please enter a password');

        setBtnLoading(registerBtn, registerSpinner, true);
        try {
            const res = await fetch('/api/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            const data = await res.json();
            if (res.ok) {
                showToast('Success', 'Registration successful! Please sign in.', 'success');
                toggleAuthLink.click();
            } else {
                showAuthError(data.error || 'Registration failed');
            }
        } catch (e) {
            showAuthError('Network error. Please try again later.');
        } finally {
            setBtnLoading(registerBtn, registerSpinner, false);
        }
    }

    function handleLogout() {
        token = null; userEmail = null; userRole = 'admin';
        localStorage.clear();
        loginPasswordInput.value = '';
        clearTimeout(inactivityTimer);
        showLogin();
    }

    // --- Data Fetching & Export ---
    async function fetchData() {
        try {
            const res = await fetch(`/api/accounts?t=${Date.now()}`, { headers: { 'Authorization': `Bearer ${token}` } });
            if (res.status === 401 || res.status === 403) return handleLogout();
            
            accountsData = await res.json();
            updateServerFilterDropdown();
            renderDashboard();
            renderDownloadsSection();
        } catch (error) {
            showToast('Error', 'Error fetching data', 'danger');
        }
    }

    async function downloadExport(type) {
        try {
            showToast('Exporting...', `Generating ${type.toUpperCase()} file`, 'info');
            const res = await fetch(`/api/accounts/export/${type}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!res.ok) throw new Error();
            
            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `PointPulse_Export.${type}`;
            a.click();
            window.URL.revokeObjectURL(url);
            showToast('Success', 'Download complete', 'success');
        } catch (e) {
            showToast('Error', 'Export failed', 'danger');
        }
    }

    async function handleFileUpload() {
        const file = fileUpload.files[0];
        if (!file) return showToast('Error', 'Please select a file', 'danger');

        const formData = new FormData();
        formData.append('file', file);
        formData.append('freshUpload', freshUploadCheckbox.checked);

        confirmUploadBtn.innerText = 'Uploading...'; confirmUploadBtn.disabled = true;

        try {
            const res = await fetch('/api/accounts/upload-excel', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                body: formData
            });

            if (res.ok) {
                showToast('Success', 'Data uploaded successfully!', 'success');
                uploadModal.classList.add('hidden');
                fileUpload.value = '';
                freshUploadCheckbox.checked = false;
                fetchData();
            } else {
                const data = await res.json();
                showToast('Upload Failed', data.error, 'danger');
            }
        } catch (error) {
            showToast('Error', 'Upload error', 'danger');
        } finally {
            confirmUploadBtn.innerText = 'Upload & Sync'; confirmUploadBtn.disabled = false;
        }
    }

    // --- Rendering ---
    function updateServerFilterDropdown() {
        if (!filterServer) return;
        const servers = new Set(accountsData.map(a => a.server).filter(s => s));
        
        let html = '<option value="all">All Servers</option>';
        Array.from(servers).sort().forEach(s => {
            html += `<option value="${s}">${s}</option>`;
        });
        filterServer.innerHTML = html;
    }

    function renderDashboard() {
        renderOverviewStats();
        renderReadyToRedeem();
        renderBuckets();
        triggerActiveRender();
        renderUpdationsTable();
        renderAccountsTable('banned', bannedAccountsBody, searchBannedInput.value);
        renderDownloadsSection();
        
        // Ensure inventory is also rendered if we are on that page
        if(inventoryData.length > 0) renderInventory();
    }

    function renderOverviewStats() {
        if (!overviewStatsContainer) return;
        const activeCount = accountsData.filter(a => a.status === 'active').length;
        const bannedCount = accountsData.filter(a => a.status === 'banned').length;
        const totalPoints = accountsData.filter(a => a.status === 'active').reduce((sum, a) => sum + (a.current_points || 0), 0);

        overviewStatsContainer.innerHTML = `
            <div class="r-card">
                <div class="r-title">Active Accounts</div>
                <div class="r-stat" style="color: var(--success-color);">${activeCount}</div>
            </div>
            <div class="r-card">
                <div class="r-title">Banned Accounts</div>
                <div class="r-stat" style="color: var(--danger-color);">${bannedCount}</div>
            </div>
            <div class="r-card">
                <div class="r-title">Total Active Points</div>
                <div class="r-stat" style="color: var(--secondary-color);">${(totalPoints / 1000).toFixed(1)}K</div>
            </div>
        `;
    }

    function renderReadyToRedeem() {
        const activeAccounts = accountsData.filter(a => a.status === 'active');
        const items = [
            { name: 'Overwatch 500', cost: 5000 },
            { name: 'Roblox 400 / Amazon', cost: 6500 },
            { name: 'Plasma Wings', cost: 10000 }
        ];

        readyRedeemContainer.innerHTML = '';

        items.forEach(item => {
            const eligibleCount = activeAccounts.filter(a => a.current_points >= item.cost).length;
            const card = document.createElement('div');
            card.className = 'r-card';
            card.innerHTML = `
                <div class="r-title">${item.name}</div>
                <div class="r-stat">${eligibleCount}</div>
                <div class="r-desc">Accounts Ready (>= ${item.cost/1000}K)</div>
            `;
            readyRedeemContainer.appendChild(card);
        });
    }

    function renderBuckets() {
        const activeAccounts = accountsData.filter(a => a.status === 'active');
        const buckets = [
            { label: '0 - 5K', min: 0, max: 4999 },
            { label: '5K - 6K', min: 5000, max: 5999 },
            { label: '6K - 7K', min: 6000, max: 6999 },
            { label: '7K - 8K', min: 7000, max: 7999 },
            { label: '8K - 10K', min: 8000, max: 9999 },
            { label: '10K+', min: 10000, max: Infinity }
        ];

        bucketsContainer.innerHTML = '';
        buckets.forEach(b => {
            const accountsInBucket = activeAccounts.filter(a => a.current_points >= b.min && a.current_points <= b.max);
            const card = document.createElement('div');
            card.className = 'bucket-card';
            card.innerHTML = `<div class="bucket-range">${b.label}</div><div class="bucket-count">${accountsInBucket.length} Accounts</div>`;
            card.addEventListener('click', () => showBucketModal(b.label, accountsInBucket));
            bucketsContainer.appendChild(card);
        });
    }

    function renderInventory() {
        if (!inventoryContainer) return;
        inventoryContainer.innerHTML = '';
        
        const filtered = inventoryData.filter(r => r.code_status === currentInventoryTab);
        
        if (filtered.length === 0) {
            inventoryContainer.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; padding: 2rem; color: var(--text-secondary);">No ${currentInventoryTab} inventory found.</div>`;
            return;
        }

        filtered.forEach(r => {
            const dateLabel = r.redeemed_at.includes('T') ? new Date(r.redeemed_at).toLocaleDateString() : r.redeemed_at;
            const card = document.createElement('div');
            card.className = 'card';
            card.style.padding = '1.5rem';
            card.style.display = 'flex';
            card.style.flexDirection = 'column';
            card.style.gap = '10px';
            
            const isSold = r.code_status === 'sold';
            const statusColor = isSold ? 'var(--success-color)' : 'var(--danger-color)';
            
            card.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                    <div>
                        <div style="font-weight: 600; font-size: 1.1rem; color: var(--primary-color);"><i class="fa-solid fa-gift"></i> ${r.item_name}</div>
                        <div style="font-size: 0.85rem; color: var(--text-secondary); margin-top: 5px;">${dateLabel} | Prof: ${r.profile_no || '-'}</div>
                    </div>
                    <select class="form-input" style="padding: 0.3rem; font-size: 0.85rem; width: auto; background-color: ${statusColor}; color: white; border: none; font-weight: bold; border-radius: 4px; cursor: pointer;" onchange="toggleInventoryStatus(${r.id}, this.value)">
                        <option value="unsold" style="color: black; background: white;" ${!isSold ? 'selected' : ''}>🔴 Unsold</option>
                        <option value="sold" style="color: black; background: white;" ${isSold ? 'selected' : ''}>🟢 Sold</option>
                    </select>
                </div>
                <div style="font-size: 0.9rem; margin-top: 5px;"><strong>Email:</strong> ${r.email}</div>
                <div style="display: flex; gap: 10px; margin-top: auto; padding-top: 10px; border-top: 1px solid var(--border-color);">
                    <input type="text" id="inv-code-${r.id}" value="${r.redeemed_code || ''}" placeholder="Enter code..." class="form-input" style="flex: 1; padding: 0.4rem; font-family: monospace;">
                    <button class="btn primary-btn" style="padding: 0.4rem 1rem;" onclick="saveInventoryCode(${r.id})">Save</button>
                </div>
            `;
            inventoryContainer.appendChild(card);
        });
    }

    // --- Download Center Logic ---
    function getDownloadSelectedType() {
        const selected = document.querySelector('input[name="dl-account-type"]:checked');
        return selected ? selected.value : 'old'; // 'old' | 'new' | 'all'
    }

    function getDownloadFilteredAccounts() {
        const type = getDownloadSelectedType();
        const statusVal = dlStatusFilter ? dlStatusFilter.value : 'active';

        let list = accountsData;
        if (statusVal !== 'all') {
            list = list.filter(a => a.status === statusVal);
        }

        return list.filter(acc => {
            const isOld = acc.redemptions && acc.redemptions.length > 0;
            if (type === 'old') return isOld;
            if (type === 'new') return !isOld;
            return true; // 'all'
        });
    }

    function renderDownloadsSection() {
        if (!downloadPreviewBody) return;
        const type = getDownloadSelectedType();
        const filtered = getDownloadFilteredAccounts();
        
        const typeNames = { old: 'Old Accounts', new: 'New Accounts', all: 'All Accounts' };
        const typeLabel = typeNames[type] || 'Selected Accounts';

        if (downloadMatchCount) {
            downloadMatchCount.innerHTML = `<i class="fa-solid fa-users"></i> ${filtered.length} ${typeLabel}`;
        }
        if (dlDetailedBadge) {
            dlDetailedBadge.innerText = `Only ${typeLabel} (${filtered.length})`;
        }
        if (dlPreviewStatusText) {
            dlPreviewStatusText.innerText = `Showing ${Math.min(filtered.length, 15)} of ${filtered.length} matching accounts`;
        }

        downloadPreviewBody.innerHTML = '';
        if (filtered.length === 0) {
            const tr = document.createElement('tr');
            tr.innerHTML = `<td colspan="7" style="text-align: center; padding: 2.5rem; color: var(--text-secondary);">
                <i class="fa-solid fa-folder-open" style="font-size: 1.8rem; margin-bottom: 0.5rem; display: block;"></i>
                No ${typeLabel.toLowerCase()} found for status: <strong>${dlStatusFilter ? dlStatusFilter.options[dlStatusFilter.selectedIndex].text : 'Selected'}</strong>.
            </td>`;
            downloadPreviewBody.appendChild(tr);
            return;
        }

        filtered.slice(0, 15).forEach(acc => {
            const tr = document.createElement('tr');
            const isOld = acc.redemptions && acc.redemptions.length > 0;
            const tagHtml = isOld 
                ? '<span class="badge" style="background: var(--primary-color); color: white;">Old</span>' 
                : '<span class="badge" style="background: var(--success-color); color: white;">New</span>';
            const redempStr = (isOld && acc.redemptions) 
                ? acc.redemptions.map(r => r.item_name).join(', ') 
                : '<span class="text-secondary">None</span>';
            const statusBadge = acc.status === 'active' 
                ? '<span class="badge badge-active">Active</span>' 
                : '<span class="badge badge-banned">Banned</span>';

            tr.innerHTML = `
                <td><strong>${acc.profile_no !== null && acc.profile_no !== undefined ? acc.profile_no : '-'}</strong></td>
                <td>${acc.email || '-'}</td>
                <td>${acc.server || '-'}</td>
                <td><strong style="color: var(--secondary-color);">${acc.current_points || 0}</strong></td>
                <td>${tagHtml}</td>
                <td><div style="max-width: 200px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${(isOld && acc.redemptions) ? acc.redemptions.map(r => r.item_name).join(', ') : ''}">${redempStr}</div></td>
                <td>${statusBadge}</td>
            `;
            downloadPreviewBody.appendChild(tr);
        });
    }

    function exportToCsvFile(data, filename) {
        if (!data || data.length === 0) return;
        const headers = Object.keys(data[0]);
        const csvRows = [headers.join(',')];

        data.forEach(row => {
            const values = headers.map(header => {
                const val = row[header] === null || row[header] === undefined ? '' : String(row[header]);
                const escaped = val.replace(/"/g, '""');
                return `"${escaped}"`;
            });
            csvRows.push(values.join(','));
        });

        const csvString = '\uFEFF' + csvRows.join('\r\n');
        const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }

    function exportToXlsxFile(data, sheetName, filename) {
        if (typeof XLSX !== 'undefined') {
            const ws = XLSX.utils.json_to_sheet(data);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, sheetName);
            XLSX.writeFile(wb, filename);
        } else {
            exportToCsvFile(data, filename.replace('.xlsx', '.csv'));
        }
    }

    async function downloadDetailed(format = 'xlsx') {
        const filtered = getDownloadFilteredAccounts();
        const type = getDownloadSelectedType();

        if (filtered.length === 0) {
            return showToast('No Accounts', `No ${type} accounts match the filter`, 'warning');
        }

        showToast('Preparing Export...', `Generating Detailed ${type} accounts report`, 'info');

        const exportData = filtered.map(acc => {
            const isOld = acc.redemptions && acc.redemptions.length > 0;
            const redeemedItems = isOld ? acc.redemptions.map(r => r.item_name).join(', ') : 'None';

            return {
                'Profile No.': acc.profile_no !== null && acc.profile_no !== undefined ? acc.profile_no : '',
                'Email': acc.email || '',
                'Password': acc.password || '',
                'Alternative Mail': acc.alternative_email || '',
                'Server': acc.server || '',
                'Current Present Points': acc.current_points || 0,
                'Redeemed Item': redeemedItems,
                'Old/New Account': isOld ? 'Old Account' : 'New Account'
            };
        });

        const capitalizedType = type.charAt(0).toUpperCase() + type.slice(1);
        const filename = `PointPulse_Detailed_${capitalizedType}_Accounts.${format}`;

        if (format === 'pdf') {
            try {
                const res = await fetch('/api/accounts/export/filtered-pdf', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userIds: filtered.map(a => a.id) })
                });
                if (!res.ok) throw new Error();
                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `PointPulse_Detailed_${capitalizedType}_Accounts.pdf`;
                a.click();
                URL.revokeObjectURL(url);
                return showToast('Download Complete', `${filtered.length} accounts PDF report downloaded`, 'success');
            } catch (e) {
                return showToast('Error', 'Failed to generate PDF report', 'danger');
            }
        } else if (format === 'xlsx') {
            exportToXlsxFile(exportData, "Detailed_Accounts", filename);
        } else {
            exportToCsvFile(exportData, filename);
        }

        showToast('Download Complete', `${exportData.length} detailed accounts exported`, 'success');
    }

    async function downloadPointsList(format = 'xlsx') {
        const filtered = getDownloadFilteredAccounts();
        const type = getDownloadSelectedType();

        if (filtered.length === 0) {
            return showToast('No Accounts', `No ${type} accounts match the filter`, 'warning');
        }

        showToast('Preparing Export...', `Generating Points List for ${type} accounts`, 'info');

        const exportData = filtered.map(acc => {
            return {
                'Profile No.': acc.profile_no !== null && acc.profile_no !== undefined ? acc.profile_no : '',
                'Email': acc.email || '',
                'Server': acc.server || '',
                'Points': acc.current_points || 0
            };
        });

        const capitalizedType = type.charAt(0).toUpperCase() + type.slice(1);
        const filename = `PointPulse_Points_List_${capitalizedType}.${format}`;

        if (format === 'pdf') {
            try {
                const res = await fetch('/api/accounts/export/filtered-pdf', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userIds: filtered.map(a => a.id) })
                });
                if (!res.ok) throw new Error();
                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `PointPulse_Points_List_${capitalizedType}.pdf`;
                a.click();
                URL.revokeObjectURL(url);
                return showToast('Download Complete', `${filtered.length} accounts Points PDF downloaded`, 'success');
            } catch (e) {
                return showToast('Error', 'Failed to generate PDF report', 'danger');
            }
        } else if (format === 'xlsx') {
            exportToXlsxFile(exportData, "Points_List", filename);
        } else {
            exportToCsvFile(exportData, filename);
        }

        showToast('Download Complete', `${exportData.length} accounts points list exported`, 'success');
    }

    // --- WhatsApp Access & Bot Logic ---
    async function fetchWhatsAppUsers() {
        try {
            const res = await fetch('/api/whatsapp/users', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                whatsappUsersData = await res.json();
                renderWhatsAppUsers();
            }
        } catch (e) {
            console.error("Error fetching WhatsApp users:", e);
        }
    }

    function renderWhatsAppUsers() {
        if (!waUsersTableBody) return;
        waUsersTableBody.innerHTML = '';

        if (waUsersCountBadge) {
            const activeCount = whatsappUsersData.filter(u => u.is_active).length;
            waUsersCountBadge.innerText = `${whatsappUsersData.length} Authorized (${activeCount} Active)`;
        }

        // Update Simulator phone dropdown
        if (simPhoneSelect) {
            const currentSelected = simPhoneSelect.value;
            simPhoneSelect.innerHTML = '<option value="">Select Authorized Number...</option>';
            whatsappUsersData.forEach(u => {
                const opt = document.createElement('option');
                opt.value = u.phone_number;
                opt.innerText = `${u.name} (+${u.phone_number})${u.is_active ? '' : ' [Inactive]'}`;
                simPhoneSelect.appendChild(opt);
            });
            if (currentSelected && whatsappUsersData.some(u => u.phone_number === currentSelected)) {
                simPhoneSelect.value = currentSelected;
            } else if (whatsappUsersData.length > 0) {
                simPhoneSelect.value = whatsappUsersData[0].phone_number;
            }
        }

        if (whatsappUsersData.length === 0) {
            const tr = document.createElement('tr');
            tr.innerHTML = `<td colspan="5" style="text-align: center; padding: 2.5rem; color: var(--text-secondary);">
                <i class="fa-brands fa-whatsapp" style="font-size: 2rem; margin-bottom: 0.5rem; display: block; color: var(--text-secondary);"></i>
                No authorized WhatsApp numbers yet. Click <strong>+ Add Authorized Number</strong> to allow WhatsApp points access.
            </td>`;
            waUsersTableBody.appendChild(tr);
            return;
        }

        whatsappUsersData.forEach(u => {
            const tr = document.createElement('tr');
            const permsArray = typeof u.permissions === 'string' ? u.permissions.split(',') : (u.permissions || []);
            const permsHtml = permsArray.map(p => {
                const isPoints = p.trim().toLowerCase() === 'points_update';
                return `<span class="perm-badge ${isPoints ? 'perm-points' : ''}">${p.trim()}</span>`;
            }).join(' ');

            const statusHtml = u.is_active
                ? `<span class="badge badge-active" style="cursor: pointer;" onclick="toggleWaUserStatus(${u.id}, false)" title="Click to Deactivate">🟢 Active</span>`
                : `<span class="badge badge-banned" style="cursor: pointer;" onclick="toggleWaUserStatus(${u.id}, true)" title="Click to Activate">🔴 Inactive</span>`;

            tr.innerHTML = `
                <td><strong>${u.name}</strong></td>
                <td><code style="font-size: 0.9rem; color: var(--secondary-color);">+${u.phone_number}</code></td>
                <td>${permsHtml || '<span class="text-secondary">None</span>'}</td>
                <td>${statusHtml}</td>
                <td>
                    <div style="display: flex; gap: 8px;">
                        <button class="icon-btn" title="Edit User" onclick="openEditWaUserModal(${u.id})"><i class="fa-solid fa-pen-to-square"></i></button>
                        <button class="icon-btn" style="color: var(--danger-color);" title="Delete" onclick="deleteWaUser(${u.id}, '${u.name.replace(/'/g, "\\'")}')"><i class="fa-solid fa-trash"></i></button>
                    </div>
                </td>
            `;
            waUsersTableBody.appendChild(tr);
        });
    }

    function openAddWaUserModal() {
        if (!waUserModal) return;
        waModalTitle.innerHTML = '<i class="fa-brands fa-whatsapp" style="color: #25D366;"></i> Add Authorized Number';
        waUserIdInput.value = '';
        waUserNameInput.value = '';
        waUserPhoneInput.value = '';
        waPermPointsUpdate.checked = true;
        waPermViewPoints.checked = true;
        waUserIsActive.checked = true;
        waUserModal.classList.remove('hidden');
    }

    window.openEditWaUserModal = function(id) {
        const u = whatsappUsersData.find(user => user.id === id);
        if (!u || !waUserModal) return;

        waModalTitle.innerHTML = '<i class="fa-brands fa-whatsapp" style="color: #25D366;"></i> Edit Authorized Number';
        waUserIdInput.value = u.id;
        waUserNameInput.value = u.name;
        waUserPhoneInput.value = u.phone_number;
        
        const perms = (u.permissions || '').toLowerCase();
        waPermPointsUpdate.checked = perms.includes('points_update') || perms.includes('admin');
        waPermViewPoints.checked = perms.includes('view_points') || perms.includes('admin');
        waUserIsActive.checked = !!u.is_active;

        waUserModal.classList.remove('hidden');
    };

    async function saveWaUser() {
        const id = waUserIdInput.value;
        const name = waUserNameInput.value.trim();
        const phone = waUserPhoneInput.value.trim();

        if (!name || !phone) {
            return showToast('Validation Error', 'Please enter both name and phone number', 'warning');
        }

        const permissions = [];
        if (waPermPointsUpdate.checked) permissions.push('points_update');
        if (waPermViewPoints.checked) permissions.push('view_points');

        const payload = {
            name,
            phone_number: phone,
            permissions: permissions.join(','),
            is_active: waUserIsActive.checked
        };

        try {
            const url = id ? `/api/whatsapp/users/${id}` : '/api/whatsapp/users';
            const method = id ? 'PUT' : 'POST';

            const res = await fetch(url, {
                method,
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            if (res.ok) {
                showToast('Success', id ? 'User updated successfully' : 'Authorized number added', 'success');
                waUserModal.classList.add('hidden');
                fetchWhatsAppUsers();
            } else {
                const data = await res.json();
                showToast('Error', data.error || 'Failed to save authorized number', 'danger');
            }
        } catch (e) {
            showToast('Error', 'Network error saving authorized user', 'danger');
        }
    }

    window.toggleWaUserStatus = async function(id, newStatus) {
        try {
            const res = await fetch(`/api/whatsapp/users/${id}`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ is_active: newStatus })
            });
            if (res.ok) {
                showToast('Updated', `User is now ${newStatus ? 'Active' : 'Inactive'}`, 'info');
                fetchWhatsAppUsers();
            }
        } catch (e) {
            showToast('Error', 'Failed to toggle status', 'danger');
        }
    };

    window.deleteWaUser = async function(id, name) {
        if (!confirm(`Are you sure you want to remove authorized number for "${name}"?`)) return;
        try {
            const res = await fetch(`/api/whatsapp/users/${id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                showToast('Deleted', 'Authorized WhatsApp number removed', 'info');
                fetchWhatsAppUsers();
            } else {
                showToast('Error', 'Failed to delete user', 'danger');
            }
        } catch (e) {
            showToast('Error', 'Network error while deleting', 'danger');
        }
    };

    // Bot Simulator
    window.setSimCommand = function(cmd) {
        if (simInput) {
            simInput.value = cmd;
            simInput.focus();
        }
    };

    async function sendSimMessage() {
        const message = (simInput.value || '').trim();
        let phone = simPhoneSelect ? simPhoneSelect.value : '';

        if (!message) return;
        if (!phone) {
            if (whatsappUsersData.length > 0) {
                phone = whatsappUsersData[0].phone_number;
            } else {
                phone = '919999999999';
            }
        }

        // Add user bubble
        appendSimMessage('user', `📱 You (+${phone})`, message);
        simInput.value = '';

        try {
            const res = await fetch('/api/whatsapp/test-message', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ phone_number: phone, message: message })
            });

            const data = await res.json();
            if (data.reply) {
                appendSimMessage('bot', '🤖 PointPulse Bot', data.reply);
            } else {
                appendSimMessage('bot', '🤖 PointPulse Bot', data.error || 'No response from bot');
            }

            // If points update was confirmed, refresh dashboard data
            if (['YES', 'Y', '1', 'CONFIRM'].includes(message.toUpperCase()) && data.success) {
                fetchData();
            }
        } catch (e) {
            appendSimMessage('bot', '🤖 PointPulse Bot', '⚠️ Network error communicating with bot');
        }
    }

    function appendSimMessage(type, sender, text) {
        if (!simChatBox) return;
        const msgDiv = document.createElement('div');
        msgDiv.className = `sim-msg ${type === 'bot' ? 'sim-msg-bot' : 'sim-msg-user'}`;
        
        const senderDiv = document.createElement('div');
        senderDiv.className = 'sim-msg-sender';
        senderDiv.innerText = sender;
        
        const contentDiv = document.createElement('div');
        let formatted = text
            .replace(/\*(.*?)\*/g, '<strong>$1</strong>')
            .replace(/_(.*?)_/g, '<em>$1</em>')
            .replace(/\n/g, '<br>');
        contentDiv.innerHTML = formatted;

        msgDiv.appendChild(senderDiv);
        msgDiv.appendChild(contentDiv);
        simChatBox.appendChild(msgDiv);
        simChatBox.scrollTop = simChatBox.scrollHeight;
    }

    // --- Direct WhatsApp Device Link (Baileys) Handlers ---
    function parseJwt(t) {
        try {
            return JSON.parse(atob(t.split('.')[1]));
        } catch (e) {
            return null;
        }
    }

    function initSocket() {
        if (typeof io !== 'undefined' && !socket) {
            socket = io();
            const payload = parseJwt(token);
            if (payload && payload.admin_id) {
                socket.emit('join', payload.admin_id);
            }

            socket.on('notification', (data) => {
                showToast(data.title || 'Notification', data.message, data.type || 'info');
                fetchData();
            });

            socket.on('wa_qr', (data) => {
                if (data && data.qr && waQrImg) {
                    waQrImg.src = data.qr;
                    waQrImg.style.display = 'block';
                    if (waQrLoading) waQrLoading.style.display = 'none';
                    if (waQrBox) waQrBox.classList.remove('hidden');
                }
            });

            socket.on('wa_status', (data) => {
                updateWhatsAppUIStatus(data);
            });
        }
    }

    function updateWhatsAppUIStatus(data) {
        if (!waConnectionBadge) return;
        if (data.status === 'connected') {
            waConnectionBadge.className = 'badge badge-active';
            waConnectionBadge.innerText = `🟢 Connected (+${data.user || ''})`;
            if (btnStartWa) btnStartWa.classList.add('hidden');
            if (btnDisconnectWa) btnDisconnectWa.classList.remove('hidden');
            if (waQrBox) waQrBox.classList.add('hidden');
        } else if (data.status === 'connecting') {
            waConnectionBadge.className = 'badge';
            waConnectionBadge.style.background = 'rgba(234, 179, 8, 0.2)';
            waConnectionBadge.style.color = '#eab308';
            waConnectionBadge.innerText = '🟡 Connecting...';
            if (waQrBox) waQrBox.classList.remove('hidden');
        } else {
            waConnectionBadge.className = 'badge badge-banned';
            waConnectionBadge.innerText = '🔴 Disconnected';
            if (btnStartWa) btnStartWa.classList.remove('hidden');
            if (btnDisconnectWa) btnDisconnectWa.classList.add('hidden');
            if (waQrBox) waQrBox.classList.add('hidden');
        }
    }

    async function checkWhatsAppClientStatus() {
        try {
            const res = await fetch('/api/whatsapp/client/status', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                updateWhatsAppUIStatus(data);
                if (data.qr && data.status !== 'connected' && waQrImg) {
                    waQrImg.src = data.qr;
                    waQrImg.style.display = 'block';
                    if (waQrLoading) waQrLoading.style.display = 'none';
                    if (waQrBox) waQrBox.classList.remove('hidden');
                }
            }
        } catch (e) {
            console.error("Error checking WhatsApp client status:", e);
        }
    }

    async function startWhatsAppClient() {
        try {
            if (waQrBox) waQrBox.classList.remove('hidden');
            if (waQrLoading) {
                waQrLoading.style.display = 'block';
                waQrLoading.innerText = 'Generating QR Code...';
            }
            if (waQrImg) waQrImg.style.display = 'none';

            updateWhatsAppUIStatus({ status: 'connecting' });
            showToast('Starting WhatsApp Bot', 'Generating pairing QR code...', 'info');

            const res = await fetch('/api/whatsapp/client/start', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            updateWhatsAppUIStatus(data);
            if (data.qr && waQrImg) {
                waQrImg.src = data.qr;
                waQrImg.style.display = 'block';
                if (waQrLoading) waQrLoading.style.display = 'none';
            }
        } catch (e) {
            showToast('Error', 'Failed to initialize WhatsApp scanner', 'danger');
        }
    }

    async function disconnectWhatsAppClient() {
        if (!confirm('Are you sure you want to disconnect WhatsApp bot session?')) return;
        try {
            const res = await fetch('/api/whatsapp/client/disconnect', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                showToast('Disconnected', 'WhatsApp session closed', 'info');
                updateWhatsAppUIStatus({ status: 'disconnected' });
            }
        } catch (e) {
            showToast('Error', 'Failed to disconnect WhatsApp', 'danger');
        }
    }

    window.toggleInventoryStatus = async function(id, newStatus) {
        await updateRedemption(id, { code_status: newStatus });
    };

    window.saveInventoryCode = async function(id) {
        const codeInput = document.getElementById(`inv-code-${id}`) || document.getElementById(`detail-code-${id}`);
        if(codeInput) {
            await updateRedemption(id, { redeemed_code: codeInput.value });
        }
    };

    window.updateDetailStatus = async function(id, newStatus, accId) {
        await updateRedemption(id, { code_status: newStatus });
        if (document.getElementById('page-account-detail').classList.contains('active')) {
            openDetailsPage(accId);
        }
    };

    window.deleteRedemption = async function(id, cost, accId) {
        if (!confirm(`Are you sure you want to delete this redemption?`)) return;
        try {
            const res = await fetch(`/api/accounts/inventory/${id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                showToast('Success', 'Redemption deleted', 'success');
                await fetchInventory();
                await fetchData();
                if (document.getElementById('page-account-detail').classList.contains('active')) {
                    openDetailsPage(accId);
                }
            } else {
                showToast('Error', 'Failed to delete redemption', 'danger');
            }
        } catch (e) {
            showToast('Error', 'Network error while deleting', 'danger');
        }
    };

    async function updateRedemption(id, payload) {
        try {
            const res = await fetch(`/api/accounts/inventory/${id}`, {
                method: 'PUT',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (res.ok) {
                showToast('Success', 'Redemption updated', 'success');
                await fetchInventory();
                await fetchData(); // Make sure this is awaited so data is fresh
            } else {
                showToast('Error', 'Failed to update', 'danger');
            }
        } catch (e) {
            showToast('Error', 'Failed to update', 'danger');
        }
    }

    function renderAccountsTable(status, tbody, searchQuery) {
        tbody.innerHTML = '';
        const search = searchQuery.toLowerCase();

        let filtered = accountsData.filter(a => a.status === status);
        
        // Apply Smart Filters for Active Accounts
        if (status === 'active') {
            if (filterPoints && filterPoints.value !== 'all') {
                const parts = filterPoints.value.split('-');
                if (parts.length === 2) {
                    filtered = filtered.filter(a => a.current_points >= parseInt(parts[0]) && a.current_points < parseInt(parts[1]));
                } else if (filterPoints.value === '10000+') {
                    filtered = filtered.filter(a => a.current_points >= 10000);
                }
            }
            if (filterServer && filterServer.value !== 'all') {
                filtered = filtered.filter(a => a.server === filterServer.value);
            }
            if (filterEligibility && filterEligibility.value !== 'all') {
                const threshold = parseInt(filterEligibility.value);
                filtered = filtered.filter(a => a.current_points >= threshold);
            }
        }

        if (search) {
            filtered = filtered.filter(a => 
                (a.email || '').toLowerCase().includes(search) || 
                String(a.profile_no || '').toLowerCase().includes(search)
            );
        }

        // Sorting
        const sortVal = filterSort ? filterSort.value : 'profile-asc';
        if (sortVal === 'points-desc') {
            filtered.sort((a, b) => (b.current_points || 0) - (a.current_points || 0));
        } else if (sortVal === 'points-asc') {
            filtered.sort((a, b) => (a.current_points || 0) - (b.current_points || 0));
        } else if (sortVal === 'profile-desc') {
            filtered.sort((a, b) => {
                if (a.is_pinned !== b.is_pinned) return b.is_pinned - a.is_pinned;
                return (b.profile_no || 0) - (a.profile_no || 0);
            });
        } else {
            // profile-asc (default)
            filtered.sort((a, b) => {
                if (a.is_pinned !== b.is_pinned) return b.is_pinned - a.is_pinned;
                return (a.profile_no || 0) - (b.profile_no || 0);
            });
        }

        if (status === 'active') {
            currentFilteredActiveAccounts = filtered;
        }

        // Empty State
        if (filtered.length === 0) {
            const tr = document.createElement('tr');
            tr.innerHTML = `<td colspan="${status === 'active' ? 6 : 5}" style="text-align: center; padding: 3rem; color: var(--text-secondary);">
                <div style="font-size: 2rem; margin-bottom: 1rem;">😕</div>
                <div style="font-weight: 500; font-size: 1.1rem; margin-bottom: 0.5rem;">No accounts found</div>
                <div style="font-size: 0.9rem;">Try changing your filters or search query</div>
            </td>`;
            tbody.appendChild(tr);
            return;
        }

        filtered.forEach(acc => {
            const tr = document.createElement('tr');
            if (status === 'banned') tr.classList.add('row-banned');

            const timeStr = acc.last_updated ? new Date(acc.last_updated).toLocaleString() : 'Never';
            
            // Highlight matching text in email
            let displayEmail = acc.email;
            if (search && displayEmail.toLowerCase().includes(search)) {
                const regex = new RegExp(`(${search})`, 'gi');
                displayEmail = displayEmail.replace(regex, '<mark>$1</mark>');
            }

            // Points Edit Logic
            let pointsHtml = `<span style="font-weight: 600;">${acc.current_points}</span>`;


            // Actions Logic
            let actionsHtml = '';
            if (userRole === 'admin') {
                actionsHtml += `<button class="icon-btn" style="color: var(--secondary-color);" title="View Details" onclick="openDetailsPage(${acc.id})"><i class="fa-solid fa-file-invoice"></i></button>`;
                actionsHtml += `<button class="icon-btn" title="Edit Details" onclick="openEditModal(${acc.id})"><i class="fa-solid fa-pen-to-square"></i></button>`;
                if (status === 'active') {
                    actionsHtml += `<button class="icon-btn" style="color: var(--primary-color);" title="Redeem Item" onclick="openRedeemModal(${acc.id}, '${acc.email}', '${acc.server || ''}')"><i class="fa-solid fa-gift"></i></button>`;
                }
            } else {
                actionsHtml = '<span class="text-secondary">-</span>';
            }
            
            // Notes indicator
            let notesHtml = acc.notes ? `<i class="fa-solid fa-comment-dots text-secondary" title="${acc.notes}" style="margin-left: 5px; cursor: help;"></i>` : '';
            
            // Phase 3: Copy row summary
            let copyHtml = `<i class="fa-regular fa-copy copy-btn" title="Copy Info" onclick="copyRowSummary('${acc.email}', ${acc.current_points})"></i>`;
            
            // Pin icon
            let pinClass = acc.is_pinned ? 'fa-solid fa-star' : 'fa-regular fa-star';
            let pinColor = acc.is_pinned ? 'color: #f1c40f;' : 'color: var(--text-secondary);';
            let pinHtml = `<i class="${pinClass}" style="${pinColor} cursor: pointer; margin-right: 5px;" onclick="togglePin(${acc.id}, ${!acc.is_pinned})" title="Toggle Pin"></i>`;

            if (status === 'active') {
                let tagHtml = (acc.redemptions && acc.redemptions.length > 0) 
                    ? '<span class="badge" style="background: var(--primary-color); color: white;">Old</span>' 
                    : '<span class="badge" style="background: var(--success-color); color: white;">New</span>';

                tr.innerHTML = `
                    <td>${pinHtml}<strong>${acc.profile_no !== null ? acc.profile_no : '-'}</strong></td>
                    <td>${displayEmail} ${notesHtml} ${copyHtml}</td>
                    <td>${acc.server || '-'}</td>
                    <td>${pointsHtml}</td>
                    <td>${tagHtml}</td>
                    <td><div style="display: flex; gap: 8px;">${actionsHtml}</div></td>
                `;
            } else {
                tr.innerHTML = `
                    <td>${pinHtml}<strong>${acc.profile_no !== null ? acc.profile_no : '-'}</strong></td>
                    <td>${displayEmail} ${notesHtml} ${copyHtml}</td>
                    <td>${acc.server || '-'}</td>
                    <td>${pointsHtml}</td>
                    <td><div style="display: flex; gap: 8px;">${actionsHtml}</div></td>
                `;
            }

            tbody.appendChild(tr);
        });
    }

    // --- Actions & Modals ---
    window.updatePoints = async function(id) {
        if (userRole !== 'admin') return;
        const input = document.getElementById(`pt-input-${id}`);
        const newPoints = parseFloat(input.value);
        if (isNaN(newPoints)) return;

        try {
            const res = await fetch(`/api/accounts/${id}`, {
                method: 'PUT',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ points: newPoints })
            });
            if (res.ok) {
                showToast('Success', 'Points updated successfully', 'success');
                fetchData();
            } else {
                showToast('Error', 'Failed to update points', 'danger');
            }
        } catch (e) {
            showToast('Error', 'Failed to update points', 'danger');
        }
    };

    window.updateBulkPoints = async function(id) {
        if (userRole !== 'admin') return;
        const input = document.getElementById(`bulk-pt-input-${id}`);
        const btn = document.getElementById(`bulk-save-btn-${id}`);
        const newPoints = parseFloat(input.value);
        if (isNaN(newPoints)) return showToast('Error', 'Invalid points value', 'danger');

        btn.innerText = 'Saving...';
        btn.disabled = true;

        try {
            const res = await fetch(`/api/accounts/${id}`, {
                method: 'PUT',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ points: newPoints })
            });
            if (res.ok) {
                showToast('Success', 'Points updated successfully', 'success');
                input.value = '';
                fetchData();
            } else {
                showToast('Error', 'Failed to update points', 'danger');
                btn.innerText = 'Update';
                btn.disabled = false;
            }
        } catch (e) {
            showToast('Error', 'Failed to update points', 'danger');
            btn.innerText = 'Update';
            btn.disabled = false;
        }
    };

    window.quickBan = async function(id) {
        if (userRole !== 'admin') return;
        if (!confirm('Are you sure you want to ban this account?')) return;
        
        try {
            const res = await fetch(`/api/accounts/${id}`, {
                method: 'PUT',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'banned' })
            });
            if (res.ok) {
                showToast('Success', 'Account banned', 'success');
                fetchData();
            }
        } catch (e) {
            console.error(e);
            showToast('Error', 'Failed to fetch accounts', 'danger');
        }
    }

    async function fetchInventory() {
        if (!token) return;
        try {
            const res = await fetch(`/api/accounts/inventory?t=${Date.now()}`, { headers: { 'Authorization': `Bearer ${token}` } });
            if (res.ok) {
                inventoryData = await res.json();
                renderInventory();
            }
        } catch (e) {
            console.error('Failed to fetch inventory:', e);
        }
    }

    // Refresh inventory whenever data is fetched
    const originalFetchData = fetchData;
    fetchData = async () => {
        await originalFetchData();
        await fetchInventory();
    };

    window.togglePin = async function(id, isPinned) {
        if (userRole !== 'admin') return;
        try {
            const res = await fetch(`/api/accounts/${id}`, {
                method: 'PUT',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ is_pinned: isPinned })
            });
            if(res.ok) fetchData();
        } catch(e) {}
    }

    window.openDetailsPage = function(id) {
        const acc = accountsData.find(a => a.id === id);
        if (!acc) return;

        document.getElementById('detail-profile').innerText = acc.profile_no || '-';
        document.getElementById('detail-email').innerText = acc.email || '-';
        document.getElementById('detail-server').innerHTML = parseServerDetails(acc.server);
        document.getElementById('detail-proton').innerText = acc.proton_email || '-';
        document.getElementById('detail-password').innerText = acc.password || '-';
        document.getElementById('detail-alt').innerText = acc.alternative_email || '-';
        
        document.getElementById('detail-points').innerText = acc.current_points;
        document.getElementById('detail-last-updated').innerText = acc.last_updated ? new Date(acc.last_updated).toLocaleString() : 'Never';
        document.getElementById('detail-total-redemptions').innerText = acc.redemptions ? acc.redemptions.length : 0;

        const pointsHistoryBody = document.getElementById('detail-points-history-body');
        pointsHistoryBody.innerHTML = '';
        if (!acc.points_history || acc.points_history.length === 0) {
            pointsHistoryBody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-secondary);">No points history found.</td></tr>';
        } else {
            // Sort to show the newest updates first
            const sortedHistory = [...acc.points_history].reverse();
            sortedHistory.forEach(h => {
                const dateLabel = new Date(h.updated_at).toLocaleString();
                pointsHistoryBody.innerHTML += `
                    <tr>
                        <td style="color: var(--text-secondary);">${h.prev_points} pts</td>
                        <td><strong>${h.new_points} pts</strong></td>
                        <td style="color: var(--success-color); font-weight: bold;">+${h.diff} <i class="fa-solid fa-arrow-trend-up"></i></td>
                        <td>${dateLabel}</td>
                    </tr>
                `;
            });
        }

        const tbody = document.getElementById('detail-redemptions-body');
        tbody.innerHTML = '';
        
        if (!acc.redemptions || acc.redemptions.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-secondary);">No redemptions found.</td></tr>';
        } else {
            acc.redemptions.forEach(r => {
                const dateLabel = r.redeemed_at.includes('T') ? new Date(r.redeemed_at).toLocaleDateString() : r.redeemed_at;
                const isSold = r.code_status === 'sold';
                const statusDot = isSold ? '🟢' : '🔴';
                const statusColor = isSold ? 'var(--success-color)' : 'var(--danger-color)';
                const statusLabel = r.code_status ? r.code_status.charAt(0).toUpperCase() + r.code_status.slice(1) : 'Unsold';
                
                tbody.innerHTML += `
                    <tr>
                        <td><i class="fa-solid fa-gift" style="color: var(--primary-color);"></i> ${r.item_name}</td>
                        <td>${dateLabel}</td>
                        <td>
                            <div style="display: flex; gap: 5px;">
                                <input type="text" id="detail-code-${r.id}" value="${r.redeemed_code || ''}" class="form-input" style="width: 150px; padding: 0.3rem; font-family: monospace; font-size: 0.85rem;" placeholder="Code...">
                                <button class="btn secondary-btn" style="padding: 0.3rem 0.6rem; font-size: 0.8rem;" onclick="saveInventoryCode(${r.id})">Save</button>
                                <button class="btn danger-btn" style="padding: 0.3rem 0.6rem; font-size: 0.8rem;" onclick="deleteRedemption(${r.id}, ${r.points_cost}, ${acc.id})"><i class="fa-solid fa-trash"></i></button>
                            </div>
                        </td>
                        <td>
                            <select class="form-input" style="padding: 0.3rem; font-size: 0.85rem; width: auto; background-color: ${statusColor}; color: white; border: none; font-weight: bold; border-radius: 4px; cursor: pointer;" onchange="updateDetailStatus(${r.id}, this.value, ${acc.id})">
                                <option value="unsold" style="color: black; background: white;" ${!isSold ? 'selected' : ''}>🔴 Unsold</option>
                                <option value="sold" style="color: black; background: white;" ${isSold ? 'selected' : ''}>🟢 Sold</option>
                            </select>
                        </td>
                    </tr>
                `;
            });
        }

        shareTotalReportBtn.onclick = async () => {
            try {
                showToast('Exporting...', 'Generating PDF report', 'info');
                const res = await fetch(`/api/accounts/export/pdf/${id}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (!res.ok) throw new Error();
                
                const blob = await res.blob();
                const pdfBlobUrl = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = pdfBlobUrl;
                a.download = `Account_Report_${acc.profile_no || id}.pdf`;
                a.click();
                showToast('Success', 'Download complete', 'success');
            } catch (e) {
                showToast('Error', 'Export failed', 'danger');
            }
        };

        document.querySelectorAll('.page-view').forEach(view => {
            view.classList.remove('active');
            view.classList.add('hidden');
        });
        const detailPage = document.getElementById('page-account-detail');
        detailPage.classList.add('active');
        detailPage.classList.remove('hidden');
    };

    window.openEditModal = function(id) {
        if (userRole !== 'admin') return;
        const acc = accountsData.find(a => a.id === id);
        if (!acc) return;

        editId.value = acc.id;
        editProfile.value = acc.profile_no || '';
        editEmail.value = acc.email || '';
        editServer.value = acc.server || '';
        if(editProton) editProton.value = acc.proton_email || '';
        if(editPassword) editPassword.value = acc.password || '';
        if(editAltEmail) editAltEmail.value = acc.alternative_email || '';
        editStatus.value = acc.status || 'active';
        if(editNotes) editNotes.value = acc.notes || '';

        editModal.classList.remove('hidden');
    };

    async function saveAccountEdit() {
        const id = editId.value;
        const payload = {
            profile_no: editProfile.value ? parseInt(editProfile.value) : null,
            email: editEmail.value,
            server: editServer.value,
            proton_email: editProton ? editProton.value : '',
            password: editPassword ? editPassword.value : '',
            alternative_email: editAltEmail ? editAltEmail.value : '',
            status: editStatus.value
        };
        if(editNotes) payload.notes = editNotes.value;

        try {
            const res = await fetch(`/api/accounts/${id}`, {
                method: 'PUT',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (res.ok) {
                showToast('Success', 'Account updated successfully', 'success');
                editModal.classList.add('hidden');
                fetchData();
            }
        } catch (e) {
            showToast('Error', 'Failed to update account', 'danger');
        }
    }

    window.openRedeemModal = function(id, email, server) {
        if (userRole !== 'admin') return;
        redeemUserId.value = id;
        redeemUserEmail.value = email;
        redeemUserServer.value = server;
        redeemEmailDisplay.innerText = email;
        redeemDate.valueAsDate = new Date(); 
        redeemModal.classList.remove('hidden');
    };

    function shareToWhatsApp() {
        const email = redeemUserEmail.value;
        const server = redeemUserServer.value || '';
        const message = `${email}                                    ${server}`;
        const encodedMessage = encodeURIComponent(message);
        window.open(`https://wa.me/?text=${encodedMessage}`, '_blank');
    }

    async function confirmRedemption() {
        const id = redeemUserId.value;
        const selectedOption = redeemItemSelect.options[redeemItemSelect.selectedIndex];
        const item_name = selectedOption.value;
        const points_cost = parseFloat(selectedOption.dataset.cost);
        const rDate = redeemDate.value;
        const redeemed_code = redeemCodeInput ? redeemCodeInput.value : '';
        const code_status = redeemStatusSelect ? redeemStatusSelect.value : 'unsold';

        if (!rDate) return showToast('Error', 'Please select a date', 'danger');

        try {
            const res = await fetch(`/api/accounts/${id}/redeem`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ item_name, points_cost, redeemed_at: rDate, redeemed_code, code_status })
            });

            if (res.ok) {
                showToast('Success', 'Item redeemed successfully', 'success');
                redeemModal.classList.add('hidden');
                fetchData();
            } else {
                showToast('Error', 'Failed to redeem', 'danger');
            }
        } catch (e) {
            showToast('Error', 'Error saving redemption', 'danger');
        }
    }

    function showBucketModal(title, accounts) {
        document.getElementById('bucket-modal-title').innerText = `Accounts: ${title}`;
        const tbody = document.getElementById('bucket-body');
        tbody.innerHTML = '';

        accounts.forEach(acc => {
            const tr = document.createElement('tr');
            let redemptionsHtml = acc.redemptions.map(r => {
                const d = r.redeemed_at.includes('T') ? new Date(r.redeemed_at).toLocaleDateString() : r.redeemed_at;
                return `<span class="h-tag">${r.item_name} (${d})</span>`;
            }).join('');
            tr.innerHTML = `
                <td>${acc.profile_no !== null ? acc.profile_no : '-'}</td>
                <td>${acc.email}</td>
                <td>${acc.server || '-'}</td>
                <td>${acc.current_points}</td>
                <td><div class="history-tags">${redemptionsHtml}</div></td>
            `;
            tbody.appendChild(tr);
        });
        bucketModal.classList.remove('hidden');
    }

    window.copyRowSummary = function(email, points) {
        const summary = `Account: ${email} | Points: ${points}`;
        navigator.clipboard.writeText(summary);
        showToast('Copied', 'Account info copied to clipboard', 'info');
    };

    function copyFilteredEmails() {
        const rows = Array.from(activeAccountsBody.querySelectorAll('tr'));
        const emails = rows.map(tr => tr.children[1].innerText.split(' ')[0].trim()).filter(e => e);
        if(emails.length === 0) return showToast('Error', 'No emails to copy', 'danger');
        
        navigator.clipboard.writeText(emails.join(', '));
        showToast('Copied', `${emails.length} emails copied to clipboard`, 'success');
    }

    // --- Share Report Functions ---
    async function generateShareReport() {
        if (!currentFilteredActiveAccounts || currentFilteredActiveAccounts.length === 0) {
            return showToast('Warning', 'No accounts to include in report', 'danger');
        }

        const userIds = currentFilteredActiveAccounts.map(a => a.id);
        
        try {
            showToast('Exporting...', 'Generating PDF report', 'info');
            const res = await fetch(`/api/accounts/export/filtered-pdf`, {
                method: 'POST',
                headers: { 
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ userIds })
            });
            
            if (!res.ok) throw new Error();
            
            const blob = await res.blob();
            const pdfBlobUrl = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = pdfBlobUrl;
            a.download = `Filtered_Accounts_Report.pdf`;
            a.click();
            showToast('Success', 'Download complete', 'success');
        } catch (e) {
            console.error(e);
            showToast('Error', 'Export failed', 'danger');
        }
    }

    function renderUpdationsTable() {
        if (!updationsAccountsBody) return;
        updationsAccountsBody.innerHTML = '';
        
        // Show all active accounts for bulk updations view
        let updationsData = accountsData.filter(a => a.status === 'active');
        
        // Sort by profile no asc by default for easy data entry
        updationsData.sort((a, b) => (a.profile_no || 0) - (b.profile_no || 0));
        
        updationsData.forEach(acc => {
            const tr = document.createElement('tr');
            const timeStr = acc.last_updated ? new Date(acc.last_updated).toLocaleString() : 'Never';
            
            tr.innerHTML = `
                <td><strong>${acc.profile_no !== null ? acc.profile_no : '-'}</strong></td>
                <td>${acc.email}</td>
                <td><span class="badge badge-active" style="font-size: 0.95rem; background: transparent; padding: 0; color: var(--text-primary);"><strong>${acc.current_points}</strong> pts</span></td>
                <td>
                    <div class="points-edit-container" style="background: rgba(0,0,0,0.2); padding: 0.4rem; border-radius: 8px; border: 1px solid var(--border-color); display: inline-flex; width: auto; align-items: center;">
                        <input type="number" class="points-input" style="border: none; background: transparent; width: 110px; text-align: left; padding-left: 10px; color: var(--text-primary); outline: none; font-size: 0.95rem;" placeholder="New points..." id="bulk-pt-input-${acc.id}">
                        <button class="btn primary-btn" style="padding: 0.4rem 1rem; font-size: 0.8rem; border-radius: 6px; box-shadow: none;" onclick="updateBulkPoints(${acc.id})" id="bulk-save-btn-${acc.id}">Update</button>
                    </div>
                </td>
                <td><span class="time-label">${timeStr}</span></td>
            `;
            updationsAccountsBody.appendChild(tr);
        });
    }

    function copyReportText() {
        navigator.clipboard.writeText(reportTextArea.value);
        showToast('Copied', 'Report copied to clipboard', 'success');
    }

    function emailReportText() {
        const subject = encodeURIComponent('PointPulse Account Report');
        const body = encodeURIComponent(reportTextArea.value);
        window.open(`mailto:?subject=${subject}&body=${body}`);
    }

    function whatsappReportText() {
        const text = encodeURIComponent(reportTextArea.value);
        window.open(`https://wa.me/?text=${text}`, '_blank');
    }

    function toggleTheme() {
        document.body.classList.toggle('light-theme');
        const isLight = document.body.classList.contains('light-theme');
        themeToggle.innerHTML = isLight ? '<i class="fa-solid fa-moon"></i> Theme' : '<i class="fa-solid fa-sun"></i> Theme';
    }

    function showToast(title, message, type = 'success') {
        toast.querySelector('#toast-title').innerText = title;
        toast.querySelector('#toast-message').innerText = message;
        const icon = toast.querySelector('i');
        if (type === 'danger') {
            icon.className = 'fa-solid fa-circle-exclamation';
            toast.style.borderLeftColor = 'var(--danger-color)';
            icon.style.color = 'var(--danger-color)';
        } else if (type === 'info') {
            icon.className = 'fa-solid fa-circle-info';
            toast.style.borderLeftColor = 'var(--secondary-color)';
            icon.style.color = 'var(--secondary-color)';
        } else {
            icon.className = 'fa-solid fa-circle-check';
            toast.style.borderLeftColor = 'var(--success-color)';
            icon.style.color = 'var(--success-color)';
        }
        toast.classList.remove('hidden');
        setTimeout(() => toast.classList.add('hidden'), 4000);
    }
});
