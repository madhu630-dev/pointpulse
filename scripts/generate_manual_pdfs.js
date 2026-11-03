/**
 * PointPulse Platform Comprehensive PDF Manual Generator
 * Generates official, publication-quality PDF operating manuals
 * for both User/Operator and Platform Administrator.
 */

const PDFDocument = require('pdfkit-table');
const fs = require('fs');
const path = require('path');

// Ensure output directories exist
const outDir = path.join(__dirname, '..', 'public', 'downloads');
if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
}

// -----------------------------------------------------------------------------
// STYLING & HELPER UTILITIES
// -----------------------------------------------------------------------------
function checkPageSpace(doc, requiredHeight = 80) {
    if (doc.y + requiredHeight > 750) {
        doc.addPage({ margin: 40, size: 'A4' });
    }
}

function addCoverPage(doc, title, subtitle, targetAudience, badgeText) {
    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;

    // Background
    doc.rect(0, 0, pageWidth, pageHeight).fill('#0f172a');

    // Decorative top accent bar
    doc.rect(40, 40, pageWidth - 80, 5).fill('#6366f1');

    // Brand Header
    doc.fillColor('#ffffff').fontSize(28).font('Helvetica-Bold')
       .text('POINTPULSE', 40, 160, { tracking: 2 });
    
    doc.fillColor('#94a3b8').fontSize(13).font('Helvetica')
       .text('Enterprise Performance & Rewards Management Platform', 40, 200);

    // Divider
    doc.rect(40, 230, 80, 3).fill('#38bdf8');

    // Title
    doc.fillColor('#f8fafc').fontSize(22).font('Helvetica-Bold')
       .text(title, 40, 255, { width: 515 });

    if (subtitle) {
        doc.fillColor('#cbd5e1').fontSize(12).font('Helvetica')
           .text(subtitle, 40, 295, { width: 515, lineGap: 3 });
    }

    // Target Audience Badge
    doc.roundedRect(40, 350, 340, 32, 6).fill('#1e293b');
    doc.fillColor('#38bdf8').fontSize(10).font('Helvetica-Bold')
       .text(`TARGET AUDIENCE: ${targetAudience.toUpperCase()}`, 55, 361);

    // Metadata Card
    const now = new Date();
    const metaY = 440;
    doc.roundedRect(40, metaY, pageWidth - 80, 150, 8)
       .fillOpacity(0.08).fill('#ffffff').strokeOpacity(0.25).stroke('#ffffff');

    doc.fillOpacity(1.0);
    doc.fillColor('#94a3b8').fontSize(10).font('Helvetica-Bold')
       .text('DOCUMENT SPECIFICATIONS & GOVERNANCE', 60, metaY + 16);

    doc.fillColor('#ffffff').fontSize(9.5).font('Helvetica')
       .text(`Official Release: November 2026 (Platform v2.4)`, 60, metaY + 38)
       .text(`Live Production URL: https://pointpulse-8bbn.onrender.com`, 60, metaY + 56)
       .text(`Governance Model: Single-Administrator Authority (001.workme@gmail.com)`, 60, metaY + 74)
       .text(`Primary Operator: laptopmew1@gmail.com`, 60, metaY + 92)
       .text(`Security Architecture: Zero Plain-Text Password Exposure • Bcrypt Authenticated`, 60, metaY + 110)
       .text(`Security Notice: Confidential internal documentation. Do not distribute externally.`, 60, metaY + 128);

    // Bottom Footer
    doc.fillColor('#64748b').fontSize(8.5).font('Helvetica')
       .text('PointPulse Platform Operating Manual • Enterprise Edition', 40, pageHeight - 45, { align: 'center', width: pageWidth - 80 });

    // Begin content on new page
    doc.addPage({ margin: 40, size: 'A4' });
}

function addSectionHeader(doc, num, title) {
    checkPageSpace(doc, 75);
    doc.moveDown(0.8);
    
    // Background pill for section number
    const startY = doc.y;
    doc.roundedRect(40, startY, 26, 20, 4).fill('#4f46e5');
    doc.fillColor('#ffffff').fontSize(11).font('Helvetica-Bold')
       .text(String(num), 40, startY + 4, { width: 26, align: 'center' });

    doc.fillColor('#0f172a').fontSize(14).font('Helvetica-Bold')
       .text(title, 75, startY + 2, { width: 480 });

    doc.moveTo(40, startY + 26).lineTo(doc.page.width - 40, startY + 26)
       .strokeColor('#e2e8f0').lineWidth(1).stroke();

    doc.y = startY + 34;
}

function addSubHeader(doc, title) {
    checkPageSpace(doc, 50);
    doc.moveDown(0.5);
    doc.fillColor('#4338ca').fontSize(11.5).font('Helvetica-Bold')
       .text(title, 40, doc.y, { width: 515 });
    doc.moveDown(0.3);
}

function addParagraph(doc, text) {
    checkPageSpace(doc, 30);
    doc.fillColor('#334155').fontSize(9.5).font('Helvetica')
       .text(text, 40, doc.y, { width: 515, lineGap: 3 });
    doc.moveDown(0.4);
}

function addBullet(doc, boldLabel, text) {
    checkPageSpace(doc, 25);
    const y = doc.y;
    doc.fillColor('#6366f1').fontSize(12).text('•', 45, y - 1);
    doc.fillColor('#0f172a').fontSize(9.5).font('Helvetica-Bold')
       .text(boldLabel + ' ', 58, y, { continued: true });
    doc.fillColor('#334155').font('Helvetica')
       .text(text, { width: 495, lineGap: 2.5 });
    doc.moveDown(0.35);
}

function addCallout(doc, type, title, message) {
    checkPageSpace(doc, 65);
    doc.moveDown(0.4);
    
    let borderColor = '#6366f1';
    let bgColor = '#eef2ff';
    let titleColor = '#3730a3';
    
    if (type === 'warning') {
        borderColor = '#f59e0b';
        bgColor = '#fffbeb';
        titleColor = '#92400e';
    } else if (type === 'success') {
        borderColor = '#10b981';
        bgColor = '#ecfdf5';
        titleColor = '#065f46';
    }

    const boxY = doc.y;
    // Estimate text height
    doc.fontSize(9).font('Helvetica');
    const height = doc.heightOfString(message, { width: 485 }) + 32;

    doc.roundedRect(40, boxY, 515, height, 6).fill(bgColor);
    doc.rect(40, boxY, 4, height).fill(borderColor);

    doc.fillColor(titleColor).fontSize(10).font('Helvetica-Bold')
       .text(title, 55, boxY + 8);
    
    doc.fillColor('#1e293b').fontSize(9).font('Helvetica')
       .text(message, 55, boxY + 22, { width: 485, lineGap: 2.5 });

    doc.y = boxY + height + 8;
}

function addExampleBox(doc, title, items) {
    checkPageSpace(doc, 80);
    doc.moveDown(0.4);

    const boxY = doc.y;
    const calcHeight = 28 + (items.length * 16);

    doc.roundedRect(40, boxY, 515, calcHeight, 6)
       .fill('#f8fafc').strokeColor('#cbd5e1').lineWidth(1).stroke();

    doc.fillColor('#0284c7').fontSize(9.5).font('Helvetica-Bold')
       .text(`REAL-WORLD EXAMPLE: ${title}`, 52, boxY + 8);

    let curY = boxY + 24;
    items.forEach(([label, val]) => {
        doc.fillColor('#475569').fontSize(8.5).font('Helvetica-Bold')
           .text(label + ':', 52, curY, { width: 140 });
        doc.fillColor('#0f172a').fontSize(8.5).font('Courier-Bold')
           .text(val, 195, curY, { width: 345 });
        curY += 15;
    });

    doc.y = boxY + calcHeight + 8;
}

function finalizeDoc(doc, manualHeaderTitle) {
    const range = doc.bufferedPageRange();
    for (let i = range.start + 1; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        
        // Header
        doc.fillColor('#64748b').fontSize(8).font('Helvetica')
           .text(`PointPulse Platform Manual • ${manualHeaderTitle}`, 40, 20, { align: 'left' });
        doc.text('Confidential / Internal Guide', doc.page.width - 180, 20, { align: 'right', width: 140 });
        doc.moveTo(40, 30).lineTo(doc.page.width - 40, 30).strokeColor('#e2e8f0').lineWidth(0.5).stroke();

        // Footer
        doc.moveTo(40, doc.page.height - 30).lineTo(doc.page.width - 40, doc.page.height - 30).strokeColor('#e2e8f0').lineWidth(0.5).stroke();
        doc.fillColor('#64748b').fontSize(8).font('Helvetica')
           .text(`https://pointpulse-8bbn.onrender.com`, 40, doc.page.height - 22, { align: 'left' });
        doc.text(`Page ${i + 1} of ${range.count}`, doc.page.width - 140, doc.page.height - 22, { align: 'right', width: 100 });
    }
}

// -----------------------------------------------------------------------------
// GENERATOR 1: OPERATOR & USER MANUAL
// -----------------------------------------------------------------------------
async function generateOperatorManual() {
    const doc = new PDFDocument({ margin: 40, size: 'A4', bufferPages: true });
    const pdfPath = path.join(outDir, 'PointPulse_Operator_User_Manual.pdf');
    const writeStream = fs.createWriteStream(pdfPath);
    doc.pipe(writeStream);

    addCoverPage(
        doc,
        'OPERATOR & USER MANUAL',
        'Comprehensive Step-by-Step Operating Guide for Account Managers, Operators & Team Members',
        'Operators & Assigned Users (e.g. laptopmew1@gmail.com)',
        'OPERATOR EDITION'
    );

    // Section 1: Introduction & Architecture
    addSectionHeader(doc, 1, 'Platform Overview & Role Responsibilities');
    addParagraph(doc, 'PointPulse is an enterprise rewards, points tally, and multi-user account management platform. As an Operator, you are granted full operational control over your assigned portfolio of accounts. Your primary duties include monitoring account health, keeping points current, importing new profiles, requesting corrections, and claiming reward redemptions.');
    
    addCallout(doc, 'success', 'Zero Plain-Text Password Standard', 
        'For institutional security, account credentials stored in PointPulse display proxy configurations, servers, and recovery identifiers. Plain-text passwords are encrypted at rest and never shown on screens or reports.');

    // Section 2: Registration & Sign In
    addSectionHeader(doc, 2, 'Account Registration & Signing In');
    addParagraph(doc, 'PointPulse supports dual authentication: direct Gmail/Email with secure password, or one-click Google OAuth 2.0.');
    
    addSubHeader(doc, 'Step 2.1: Registering a New Operator Account');
    addParagraph(doc, 'If you do not yet have an approved operator profile:');
    addBullet(doc, '1. Access Portal:', 'Open your browser and navigate to https://pointpulse-8bbn.onrender.com.');
    addBullet(doc, '2. Select Create Account Tab:', 'Click the "Create Account" tab at the top of the access card.');
    addBullet(doc, '3. Fill Profile Information:', 'Enter your Full Name, your active Gmail address (e.g. laptopmew1@gmail.com), and choose a password (minimum 6 characters).');
    addBullet(doc, '4. Submit Application:', 'Click the blue "Create Account" button.');
    addBullet(doc, '5. Pending Approval Screen:', 'Your application is placed in pending review status. The Administrator (001.workme@gmail.com) will review and approve your account.');

    addExampleBox(doc, 'Operator Registration Form Values', [
        ['Full Name', 'Laptop Mew'],
        ['Gmail Address', 'laptopmew1@gmail.com'],
        ['Password', '•••••••••••• (Encrypted with bcrypt 10 rounds)'],
        ['Initial System State', 'Pending Administrator Review']
    ]);

    addSubHeader(doc, 'Step 2.2: Logging In (Direct Credentials or Google OAuth)');
    addParagraph(doc, 'Once your registration has been approved by the Administrator:');
    addBullet(doc, 'Option A (Direct Sign In):', 'Ensure "Sign In" tab is selected. Enter your Gmail address and password, then click "Sign In to PointPulse".');
    addBullet(doc, 'Option B (Google Sign-In):', 'Click the "Continue with Google" button below the login form and authenticate using your verified Google profile.');

    // Section 3: Navigating the Operator Workspace
    addSectionHeader(doc, 3, 'Navigating Your Operator Workspace');
    addParagraph(doc, 'Upon signing in, your personalized dashboard provides immediate visibility into your assigned assets:');
    addBullet(doc, 'My Overview:', 'Real-time KPI summary showing your Total Active Accounts, Total Cumulative Points, Open Requests, and Available Rewards.');
    addBullet(doc, 'Active Accounts:', 'Your primary accounts workspace showing status, server, points, and action buttons for all live profiles.');
    addBullet(doc, 'Banned Accounts:', 'Dedicated repository for accounts that have been flagged, suspended, or require remediation.');
    addBullet(doc, 'Old & New Accounts:', 'Tenure-segmented view separating mature accounts from newly registered ones.');
    addBullet(doc, 'Available Rewards:', 'Interactive catalogue of vouchers, gift cards, and payout rewards eligible for redemption.');
    addBullet(doc, 'Request Center:', 'Ticketing hub to submit Account Corrections and request temporary Points Editing Windows.');
    addBullet(doc, 'Download Reports:', 'Self-service export hub to download your accounts and points history in CSV format.');

    // Section 4: Managing Your Accounts & Dossier
    addSectionHeader(doc, 4, 'Managing Your Account Portfolio');
    addParagraph(doc, 'Under the "Active Accounts" menu, your assigned accounts are listed in a structured data table.');

    addSubHeader(doc, 'Table Columns Explained');
    addBullet(doc, 'PROF #:', 'The browser profile or system slot number (e.g. P1, P2, P3).');
    addBullet(doc, 'ACCOUNT IDENTIFIER:', 'The registered email or username for the account.');
    addBullet(doc, 'SERVER:', 'The proxy server or geographical exit node (e.g. US-AZ#146, US-DC#257).');
    addBullet(doc, 'CURRENT POINTS:', 'The current balance of verified points accumulated by this profile.');
    addBullet(doc, 'CLASSIFICATION:', 'Tenure badge indicating whether the account is classified as NEW or OLD.');
    addBullet(doc, 'STATUS:', 'Green ACTIVE badge or red BANNED badge.');

    addSubHeader(doc, 'Account Action Buttons');
    addBullet(doc, 'Details Button:', 'Opens the comprehensive Account Dossier. Contains 3 tabs: (1) Overview, (2) Credentials & Proxy information (server tags, recovery emails, masked secrets), and (3) Activity History logs.');
    addBullet(doc, 'Points Button:', 'View recent points ledger entries or submit a points update (unlocked during editing windows).');
    addBullet(doc, 'Edit Button:', 'Modify server tag, classification, or notes (unlocked during your Free Editing Period).');

    // Section 5: Adding Accounts (Single & Bulk Excel Upload)
    addSectionHeader(doc, 5, 'Adding Accounts: Single & Bulk Excel Upload');
    addParagraph(doc, 'You can add new accounts to your portfolio during your active Free Editing Period using either single entry or bulk spreadsheet upload.');

    addSubHeader(doc, 'Method A: Single Account Addition');
    addBullet(doc, '1. Click "+ Add Account":', 'Located on the top-right toolbar of the Active Accounts view.');
    addBullet(doc, '2. Enter Details:', 'Provide Profile Number (optional), Account Email, Server tag, Initial Points, and Classification.');
    addBullet(doc, '3. Save Profile:', 'Click "Save Account". The account is immediately bound to your operator profile.');

    addExampleBox(doc, 'Single Account Input', [
        ['Profile #', 'P1'],
        ['Account Email', 'rathantata51@gmail.com'],
        ['Server / Proxy', 'US-AZ#146'],
        ['Current Points', '-2500'],
        ['Classification', 'OLD'],
        ['Assigned Operator', 'laptopmew1@gmail.com']
    ]);

    addSubHeader(doc, 'Method B: Bulk Excel / CSV Upload');
    addParagraph(doc, 'To import tens or hundreds of accounts simultaneously:');
    addBullet(doc, '1. Click "Upload Excel":', 'Located next to the Free Editing Periods button on the toolbar.');
    addBullet(doc, '2. Download Template:', 'Click the "Download Sample CSV" link in the modal to review exact column headers.');
    addBullet(doc, '3. Format Spreadsheet:', 'Ensure your file conforms to the required specification below.');
    addBullet(doc, '4. Upload File:', 'Select your .csv or .xlsx file and click "Import Accounts". The system validates each row and provisions the records under your ownership.');

    const csvTable = {
        headers: [
            { label: 'Column Header', property: 'col', width: 110 },
            { label: 'Required', property: 'req', width: 65 },
            { label: 'Example Value', property: 'eg', width: 150 },
            { label: 'Field Description', property: 'desc', width: 190 }
        ],
        datas: [
            { col: 'profile_num', req: 'Yes', eg: 'P1', desc: 'Browser profile slot / identifier' },
            { col: 'account_identifier', req: 'Yes', eg: 'laptopmew.acc1@gmail.com', desc: 'Account email address' },
            { col: 'server', req: 'Yes', eg: 'US-AZ#146', desc: 'Proxy exit node / server tag' },
            { col: 'current_points', req: 'No', eg: '5200', desc: 'Current points balance (default: 0)' },
            { col: 'classification', req: 'No', eg: 'OLD', desc: 'Tenure badge (OLD or NEW)' },
            { col: 'status', req: 'No', eg: 'active', desc: 'Status (active or banned)' }
        ]
    };

    await doc.table(csvTable, {
        prepareHeader: () => doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#ffffff'),
        prepareRow: (row, i) => doc.font('Helvetica').fontSize(8).fillColor(i % 2 === 0 ? '#1e293b' : '#334155'),
        headerBackgroundColor: '#4f46e5'
    });

    // Section 6: Free Editing Period & Read-Only Mode
    addSectionHeader(doc, 6, 'Free Editing Period & Read-Only Locking');
    addCallout(doc, 'warning', 'Core Governance Mechanism: Free Editing Window',
        'PointPulse safeguards portfolio integrity by limiting full write access to designated time windows. When approved, you receive an initial Free Editing Period (e.g. 24 or 48 hours). During this window, you have full privileges to add accounts, edit servers, and upload spreadsheets. When the timer reaches zero, your portfolio automatically enters Read-Only Mode.');

    addSubHeader(doc, 'Monitoring the Live Countdown Badge');
    addParagraph(doc, 'When your window is active, a glowing green pill is displayed in the top navbar:');
    addBullet(doc, 'Active Indicator:', '[ ⏱️ Free Editing Window: 18h 45m remaining ]');
    addBullet(doc, 'Read-Only Indicator:', 'When expired, buttons change to read-only status and a tooltip directs you to the Request Center.');

    // Section 7: Request Center
    addSectionHeader(doc, 7, 'Request Center: Corrections & Points Windows');
    addParagraph(doc, 'If your portfolio is in Read-Only Mode and you need to make changes:');
    
    addSubHeader(doc, 'Submitting an Account Correction Request');
    addBullet(doc, '1. Navigate:', 'Click "Request Center" in the left sidebar.');
    addBullet(doc, '2. New Request:', 'Click the "+ New Request" button.');
    addBullet(doc, '3. Choose Category:', 'Select "Account Correction".');
    addBullet(doc, '4. Specify Account:', 'Enter the account email and detail the required change (e.g. server update).');
    addBullet(doc, '5. Submit:', 'The Administrator receives an instant notification and can approve the change with one click.');

    addExampleBox(doc, 'Account Correction Request Ticket', [
        ['Request Type', 'Account Correction'],
        ['Account Email', 'rathantata51@gmail.com'],
        ['Subject', 'Update Server Proxy'],
        ['Correction Details', 'Please update proxy from US-AZ#146 to US-CA#102 due to IP rotation'],
        ['Ticket Status', 'Pending Administrator Action']
    ]);

    addSubHeader(doc, 'Requesting a Points Editing Window');
    addParagraph(doc, 'If you need to batch update points across your portfolio:');
    addBullet(doc, '1. Select Category:', 'Choose "Points Update Window" in the Request Center.');
    addBullet(doc, '2. Specify Duration:', 'Request a 2-hour, 6-hour, or 24-hour editing session.');
    addBullet(doc, '3. Activation:', 'Once the Administrator clicks Approve, your Free Editing countdown badge starts immediately.');

    // Section 8: Reward Catalogue & Claiming
    addSectionHeader(doc, 8, 'Reward Catalogue & Redemption Workflow');
    addParagraph(doc, 'Points earned by your managed accounts can be redeemed for institutional rewards:');
    addBullet(doc, '1. Browse Catalogue:', 'Navigate to "Available Rewards" to view active gift cards, vouchers, and cash disbursements.');
    addBullet(doc, '2. Check Thresholds:', 'Each reward item displays required points (e.g. 10,000 pts). The system automatically evaluates your accounts.');
    addBullet(doc, '3. Click Redeem:', 'If your account qualifies, the "Redeem" button turns green. Click to initiate redemption.');
    addBullet(doc, '4. Fulfillment:', 'Redemption claims appear in your Request Center. The Administrator approves and fulfills the voucher.');

    // Section 9: Monthly Reviews & Exporting
    addSectionHeader(doc, 9, 'Monthly Compliance Reviews & Report Exports');
    addSubHeader(doc, 'Monthly Performance Review Form');
    addParagraph(doc, 'On the 1st of every month, PointPulse prompts operators to submit a standard operational review:');
    addBullet(doc, 'Verification:', 'Confirm the total number of active profiles currently operating.');
    addBullet(doc, 'Banned Profiles:', 'Report any accounts flagged or terminated by external platforms.');
    addBullet(doc, 'Feedback:', 'Submit operational notes or server performance comments.');

    addSubHeader(doc, 'Exporting Reports');
    addParagraph(doc, 'Navigate to "Download Reports" to export a clean, timestamped CSV spreadsheet of all your assigned accounts, current points balances, and redemption histories.');

    finalizeDoc(doc, 'Operator & User Manual');
    doc.end();

    return new Promise(resolve => writeStream.on('finish', resolve));
}

// -----------------------------------------------------------------------------
// GENERATOR 2: ADMINISTRATOR OPERATING MANUAL
// -----------------------------------------------------------------------------
async function generateAdminManual() {
    const doc = new PDFDocument({ margin: 40, size: 'A4', bufferPages: true });
    const pdfPath = path.join(outDir, 'PointPulse_Administrator_Manual.pdf');
    const writeStream = fs.createWriteStream(pdfPath);
    doc.pipe(writeStream);

    addCoverPage(
        doc,
        'ADMINISTRATOR OPERATING MANUAL',
        'Enterprise Governance, User Approvals, Portfolio Assignment & System Configuration',
        'Sole Administrator (001.workme@gmail.com)',
        'ADMINISTRATOR EDITION'
    );

    // Section 1: Single-Administrator Governance
    addSectionHeader(doc, 1, 'Single-Administrator Governance Architecture');
    addParagraph(doc, 'PointPulse operates under an uncompromising single-administrator security model designed to eliminate privilege escalation, unauthorized promotions, and administrative credential compromise.');
    
    addCallout(doc, 'warning', 'Enforced Administrator Identity: 001.workme@gmail.com',
        'The platform hardcodes the sole administrator identity to 001.workme@gmail.com at the database schema, middleware, and API levels. The system strictly prohibits the creation, invitation, or elevation of secondary administrators. All administrative endpoints require valid session tokens belonging exclusively to this identity.');

    // Section 2: Administrator Sign In
    addSectionHeader(doc, 2, 'Administrator Sign In & Dashboard Access');
    addParagraph(doc, 'The Administrator can log into PointPulse through either:');
    addBullet(doc, 'Direct Credentials:', 'Enter 001.workme@gmail.com and your master administrator password under the "Sign In" tab.');
    addBullet(doc, 'Google OAuth 2.0:', 'Click "Continue with Google" while logged into your verified 001.workme@gmail.com Google account.');

    // Section 3: User Management & Approvals
    addSectionHeader(doc, 3, 'User Management & Operator Onboarding');
    addParagraph(doc, 'All operator registrations are routed through the Administrator approval workflow before any dashboard access is permitted.');

    addSubHeader(doc, 'Step-by-Step Approval Procedure');
    addBullet(doc, '1. Open User Management:', 'Click "User Management" in the left sidebar.');
    addBullet(doc, '2. Review Pending Queue:', 'Inspect the "Pending User Approvals" table showing applicant name, email, and registration timestamp.');
    addBullet(doc, '3. Approve Applicant:', 'Click the green "Approve" button. The system immediately activates their profile and grants an initial Free Editing Window.');
    addBullet(doc, '4. Reject Applicant:', 'Click "Reject" to deny access and purge unauthorized registration attempts.');

    addSubHeader(doc, 'Granular Operator Permissions');
    addParagraph(doc, 'On the Active Operators table, click "Permissions" on any operator row to customize their capabilities:');
    addBullet(doc, 'Can Add Accounts:', 'Controls whether operator can provision new accounts during active windows.');
    addBullet(doc, 'Can Edit Points:', 'Controls whether operator can manually update points.');
    addBullet(doc, 'Can Redeem Rewards:', 'Controls whether operator can claim reward vouchers.');
    addBullet(doc, 'Suspend Operator:', 'Clicking "Suspend" immediately invalidates the user\'s active session and prevents API access.');

    addExampleBox(doc, 'Primary Operator Profile Configuration', [
        ['Operator Name', 'Laptop Mew'],
        ['Operator Email', 'laptopmew1@gmail.com'],
        ['Account Status', 'ACTIVE (Approved)'],
        ['Assigned Accounts', '100% of Master Database Accounts'],
        ['Permissions', 'Full Operator Privileges (Add Accounts, Edit Points, Redeem)']
    ]);

    // Section 4: Account Ownership & Portfolio Reassignment
    addSectionHeader(doc, 4, 'Account Ownership & Bulk Migration ("Assign All")');
    addParagraph(doc, 'The Administrator retains total authority over which operator owns which accounts.');

    addSubHeader(doc, 'The "Assigned Operator" Column & Filter');
    addBullet(doc, 'Assigned Operator Column:', 'In the "All Accounts" view, every row explicitly reveals the operator email assigned to that profile.');
    addBullet(doc, 'Filter by Operator:', 'Use the dropdown filter at the top of the table to isolate accounts owned by laptopmew1@gmail.com or unassigned accounts.');

    addSubHeader(doc, 'Reassigning Single Accounts');
    addParagraph(doc, 'To reassign an individual account:');
    addBullet(doc, '1. Edit Row:', 'Click the "Edit" button on the account row in All Accounts.');
    addBullet(doc, '2. Select Operator:', 'In the "Assign Operator" dropdown, select the target user (e.g. laptopmew1@gmail.com).');
    addBullet(doc, '3. Save:', 'Click "Save Changes". The account immediately moves into the new operator\'s dashboard.');

    addSubHeader(doc, 'Bulk Migration: "Assign All to User" Feature');
    addCallout(doc, 'success', 'One-Click Enterprise Data Migration',
        'To migrate all existing accounts in the platform to a single primary operator (such as laptopmew1@gmail.com), use the dedicated bulk migration tool.');
    addBullet(doc, '1. Click Bulk Action:', 'On the All Accounts toolbar, click the purple "Assign All to User" button.');
    addBullet(doc, '2. Choose Target User:', 'Select laptopmew1@gmail.com from the modal dropdown.');
    addBullet(doc, '3. Confirm Transfer:', 'Click "Confirm Transfer". The system executes an atomic transaction reassigning 100% of accounts and logs the migration in the immutable audit trail.');

    // Section 5: Free Editing Period Governance
    addSectionHeader(doc, 5, 'Free Editing Period Governance');
    addParagraph(doc, 'The Administrator defines the duration and rules for operator write-access windows.');
    addBullet(doc, '1. Open Settings:', 'Click the "Free Editing Periods" button on the All Accounts toolbar.');
    addBullet(doc, '2. Global Default:', 'Configure the standard window granted to newly approved operators (e.g. 24 Hours, 48 Hours, or 7 Days).');
    addBullet(doc, '3. Auto-Start Rule:', 'Toggle whether newly approved users automatically start their timer upon registration approval.');
    addBullet(doc, '4. Grant Custom Window:', 'Select an individual operator (e.g. laptopmew1@gmail.com) and grant a customized window (e.g. 12 Hours) to allow account adjustments.');

    // Section 6: Old / New Classification Board
    addSectionHeader(doc, 6, 'Old / New Classification Board (Kanban)');
    addParagraph(doc, 'Navigate to "Old / New Board" in the sidebar to access the visual account tenure interface:');
    addBullet(doc, 'Drag-and-Drop:', 'Drag account cards between the "OLD ACCOUNTS" and "NEW ACCOUNTS" columns to instantly update classification.');
    addBullet(doc, 'Batch Move:', 'Select multiple accounts and click "Move to OLD" or "Move to NEW" to perform bulk reclassifications.');

    // Section 7: Points & Access Governance
    addSectionHeader(doc, 7, 'Points Management & Access Governance');
    addParagraph(doc, 'Under "Points & Access", the Administrator monitors real-time points activity across the entire platform:');
    addBullet(doc, 'Live Active Windows:', 'View which operators currently have active points-editing windows.');
    addBullet(doc, 'Emergency Revocation:', 'Click "Revoke Window" at any moment to instantly terminate an operator\'s editing session.');

    // Section 8: Master Reward Catalogue
    addSectionHeader(doc, 8, 'Master Reward Catalogue & Redemption Fulfillment');
    addParagraph(doc, 'Navigate to "Reward Catalogue" to manage the rewards portfolio:');
    addBullet(doc, 'Add New Reward:', 'Click "+ Add New Reward" to specify Reward Title (e.g. $50 Amazon Gift Card), Category, Points Required, and Stock Count.');
    addBullet(doc, 'Publish / Unpublish:', 'Toggle whether rewards are visible to operators in their catalogue.');
    addBullet(doc, 'Account Matching:', 'Navigate to "Account Matching" to see which operator accounts meet points criteria.');
    addBullet(doc, 'Approve Redemptions:', 'Review operator redemption claims and click "Approve & Fulfill" to deduct points and issue rewards.');

    // Section 9: Notification Center
    addSectionHeader(doc, 9, 'Notification Center & Request Approvals');
    addParagraph(doc, 'The Notification Center serves as the Administrator\'s central decision inbox:');
    addBullet(doc, 'Account Correction Requests:', 'Review operator requests to fix server names or account details. Click "Approve" to apply the correction automatically.');
    addBullet(doc, 'Points Window Requests:', 'Review operator requests for editing time. Click "Approve Window" to unlock their countdown timer.');

    // Section 10: Executive PDF Generation
    addSectionHeader(doc, 10, 'Executive PDF Generation & Download Center');
    addParagraph(doc, 'Under "Download Center", generate branded, publication-ready reports:');
    addBullet(doc, 'Executive PDF Report:', 'Produces a multi-page PDF document featuring KPI overview cards, points distribution charts, operator performance summaries, and full account rosters.');
    addBullet(doc, 'Full Database CSV:', 'Exports the raw master database table into a CSV file for backup or external spreadsheet analysis.');

    // Section 11: Immutable Audit Logs
    addSectionHeader(doc, 11, 'Immutable Security Audit Logs');
    addParagraph(doc, 'Navigate to "Audit Logs" to review the tamper-evident chronological ledger:');
    addBullet(doc, 'Tracked Events:', 'Every login, approval, account creation, edit, bulk migration, points change, and window grant is recorded.');
    addBullet(doc, 'Audit Metadata:', 'Includes exact ISO timestamp, actor email, action type, target account, and IP address.');

    // Section 12: Google Cloud OAuth Setup
    addSectionHeader(doc, 12, 'Google Cloud OAuth 2.0 Configuration Guide');
    addParagraph(doc, 'To ensure Google Sign-In operates flawlessly on the live production domain:');
    addBullet(doc, '1. Open Console:', 'Navigate to Google Cloud Console → APIs & Services → Credentials.');
    addBullet(doc, '2. Open Client ID:', 'Select Client ID: 162534616388-ko0lpc0r6cpor5vb8tv23aodamelv9mv.apps.googleusercontent.com');
    addBullet(doc, '3. Authorized JavaScript Origins:', 'Add https://pointpulse-8bbn.onrender.com (without trailing slash).');
    addBullet(doc, '4. Authorized Redirect URIs:', 'Add https://pointpulse-8bbn.onrender.com and https://pointpulse-8bbn.onrender.com/api/auth/google/callback');
    addBullet(doc, '5. Render Environment:', 'Ensure GOOGLE_CLIENT_ID is saved in your Render Environment Variables.');

    finalizeDoc(doc, 'Administrator Manual');
    doc.end();

    return new Promise(resolve => writeStream.on('finish', resolve));
}

// -----------------------------------------------------------------------------
// MAIN EXECUTION
// -----------------------------------------------------------------------------
async function run() {
    console.log('Generating PointPulse PDF Manuals...');
    await generateOperatorManual();
    console.log('✅ Generated: public/downloads/PointPulse_Operator_User_Manual.pdf');
    await generateAdminManual();
    console.log('✅ Generated: public/downloads/PointPulse_Administrator_Manual.pdf');
    console.log('All PDF manuals successfully generated!');
}

run().catch(err => {
    console.error('Error generating PDF manuals:', err);
    process.exit(1);
});
