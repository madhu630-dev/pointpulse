/**
 * PointPulse Enterprise 5-Page Diagrammatic Manual Generator
 * Generates publication-ready, strictly 5-page PDF manuals
 * packed with diagrams, flowcharts, and visual workflows.
 */

const PDFDocument = require('pdfkit-table');
const fs = require('fs');
const path = require('path');

const outDir = path.join(__dirname, '..', 'public', 'downloads');
if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
}

// -----------------------------------------------------------------------------
// CORE DRAWING PRIMITIVES & DIAGRAMMATIC HELPERS
// -----------------------------------------------------------------------------

function drawPageHeader(doc, pageNum, pageTitle, manualType) {
    // Top banner
    doc.fillColor('#64748b').fontSize(8).font('Helvetica-Bold')
       .text(`POINTPULSE ENTERPRISE • ${manualType.toUpperCase()}`, 36, 22, { align: 'left' });
    doc.fillColor('#0284c7').font('Helvetica-Bold')
       .text(`PAGE ${pageNum} OF 5`, doc.page.width - 136, 22, { align: 'right', width: 100 });
    
    // Header divider line
    doc.moveTo(36, 34).lineTo(doc.page.width - 36, 34).strokeColor('#cbd5e1').lineWidth(0.75).stroke();

    // Page Section Title
    doc.fillColor('#0f172a').fontSize(14).font('Helvetica-Bold')
       .text(pageTitle, 36, 42, { width: 523 });
    doc.moveTo(36, 60).lineTo(180, 60).strokeColor('#4f46e5').lineWidth(2).stroke();
}

function drawPageFooter(doc) {
    const footerY = 788;
    doc.moveTo(36, footerY).lineTo(doc.page.width - 36, footerY).strokeColor('#e2e8f0').lineWidth(0.75).stroke();
    doc.fillColor('#64748b').fontSize(7.5).font('Helvetica')
       .text('PointPulse Platform v2.4 • Confidential Internal Operating Documentation', 36, footerY + 6, { align: 'left', lineBreak: false });
    doc.fillColor('#4f46e5').font('Helvetica-Bold')
       .text('https://pointpulse-8bbn.onrender.com', doc.page.width - 236, footerY + 6, { align: 'right', width: 200, lineBreak: false });
}

function drawCard(doc, x, y, w, h, title, borderColor = '#cbd5e1', bgColor = '#f8fafc', titleColor = '#0f172a') {
    doc.roundedRect(x, y, w, h, 6).fill(bgColor).strokeColor(borderColor).lineWidth(1).stroke();
    if (title) {
        doc.fillColor(titleColor).fontSize(10).font('Helvetica-Bold')
           .text(title, x + 12, y + 8, { width: w - 24 });
    }
}

function drawFlowStep(doc, x, y, w, h, stepNum, title, desc, color = '#4f46e5', bgColor = '#ffffff') {
    doc.roundedRect(x, y, w, h, 6).fill(bgColor).strokeColor(color).lineWidth(1.2).stroke();
    
    // Step number pill
    doc.roundedRect(x + 8, y + 8, 20, 16, 4).fill(color);
    doc.fillColor('#ffffff').fontSize(8.5).font('Helvetica-Bold')
       .text(String(stepNum), x + 8, y + 12, { width: 20, align: 'center' });

    // Step Title
    doc.fillColor('#0f172a').fontSize(9.5).font('Helvetica-Bold')
       .text(title, x + 34, y + 10, { width: w - 42 });

    // Step Description
    if (desc) {
        doc.fillColor('#334155').fontSize(8).font('Helvetica')
           .text(desc, x + 10, y + 28, { width: w - 20, lineGap: 1.5 });
    }
}

function drawConnectorDown(doc, x, y, length = 14, label = '') {
    const endY = y + length;
    doc.moveTo(x, y).lineTo(x, endY).strokeColor('#6366f1').lineWidth(1.5).stroke();
    // Arrow head
    doc.polygon([x - 3.5, endY - 4], [x + 3.5, endY - 4], [x, endY]).fill('#6366f1');
    if (label) {
        doc.fillColor('#4f46e5').fontSize(7.5).font('Helvetica-Bold')
           .text(label, x + 6, y + 2);
    }
}

function drawConnectorRight(doc, x, y, length = 18, label = '') {
    const endX = x + length;
    doc.moveTo(x, y).lineTo(endX, y).strokeColor('#6366f1').lineWidth(1.5).stroke();
    // Arrow head
    doc.polygon([endX - 4, y - 3.5], [endX - 4, y + 3.5], [endX, y]).fill('#6366f1');
    if (label) {
        doc.fillColor('#4f46e5').fontSize(7.5).font('Helvetica-Bold')
           .text(label, x + 2, y - 10);
    }
}

function drawDiagramTable(doc, x, y, w, headers, rows, colWidths, defaultRowHeight = 16) {
    let curY = y;
    const headerHeight = 18;
    
    // Header row background
    doc.roundedRect(x, curY, w, headerHeight, 4).fill('#1e293b');
    
    let curX = x + 8;
    headers.forEach((h, i) => {
        doc.fillColor('#ffffff').fontSize(7.5).font('Helvetica-Bold')
           .text(h, curX, curY + 5, { width: colWidths[i] });
        curX += colWidths[i];
    });

    curY += headerHeight + 2;

    // Data rows
    rows.forEach((row, rIdx) => {
        const rH = row.height || defaultRowHeight;
        const rowBg = rIdx % 2 === 0 ? '#f8fafc' : '#ffffff';
        doc.roundedRect(x, curY, w, rH, 2).fill(rowBg).strokeColor('#e2e8f0').lineWidth(0.5).stroke();

        let cellX = x + 8;
        row.cols.forEach((c, i) => {
            doc.fillColor(row.bold && i === 0 ? '#0f172a' : '#334155').fontSize(7).font(row.bold && i === 0 ? 'Helvetica-Bold' : 'Helvetica')
               .text(c, cellX, curY + 3.5, { width: colWidths[i] });
            cellX += colWidths[i];
        });

        curY += rH + 1.5;
    });

    return curY;
}

// -----------------------------------------------------------------------------
// 1. OPERATOR & USER MANUAL (EXACTLY 5 PAGES)
// -----------------------------------------------------------------------------
async function buildOperatorManual() {
    const doc = new PDFDocument({ margin: 36, size: 'A4', autoFirstPage: false });
    const pdfPath = path.join(outDir, 'PointPulse_Operator_User_Manual.pdf');
    const writeStream = fs.createWriteStream(pdfPath);
    doc.pipe(writeStream);

    // ==========================================
    // PAGE 1: Architecture & Onboarding Flowchart
    // ==========================================
    doc.addPage({ margin: 36, size: 'A4' });
    drawPageHeader(doc, 1, 'Architecture & Getting Started Workflow', 'Operator & User Manual');

    // Architecture Overview Box
    drawCard(doc, 36, 68, 523, 140, 'SYSTEM ARCHITECTURE: ROLE & DATA ISOLATION', '#4f46e5', '#eef2ff', '#3730a3');
    
    // Draw 3 horizontal architecture nodes
    drawFlowStep(doc, 50, 94, 140, 52, 1, 'PointPulse Cloud', 'Secure Production Node\npointpulse-8bbn.onrender.com', '#0284c7');
    drawConnectorRight(doc, 192, 120, 24);
    drawFlowStep(doc, 218, 94, 150, 52, 2, 'Operator Identity', 'User: laptopmew1@gmail.com\nBcrypt Authenticated & Approved', '#4f46e5');
    drawConnectorRight(doc, 370, 120, 24);
    drawFlowStep(doc, 396, 94, 145, 52, 3, 'Assigned Portfolio', 'Strict Data Isolation\nOnly assigned accounts visible', '#10b981');

    doc.fillColor('#334155').fontSize(8).font('Helvetica')
       .text('Security Rule: Zero plain-text passwords stored or displayed. Strict database isolation ensures operators cannot view or alter other users\' accounts.', 50, 160, { width: 495 });

    // FLOWCHART: Onboarding Lifecycle (Vertical pipeline)
    drawCard(doc, 36, 218, 523, 400, 'ONBOARDING LIFECYCLE: FROM SIGNUP TO DASHBOARD ACCESS', '#cbd5e1', '#ffffff');

    drawFlowStep(doc, 52, 244, 490, 48, 1, 'Access Access Portal & Select Registration Tab', 'Navigate to https://pointpulse-8bbn.onrender.com and click the "Create Account" tab at the top of the authentication card.', '#4f46e5');
    drawConnectorDown(doc, 297, 294, 14);

    drawFlowStep(doc, 52, 310, 490, 48, 2, 'Submit Registration Form with Gmail & Password', 'Enter Full Name, active Gmail (e.g. laptopmew1@gmail.com), and secure password. Credentials are encrypted using bcrypt (10 rounds).', '#4f46e5');
    drawConnectorDown(doc, 297, 360, 14);

    drawFlowStep(doc, 52, 376, 490, 48, 3, 'Application Queued: Pending Review Screen', 'PointPulse displays "Application Submitted: Pending review by Administrator (001.workme@gmail.com)". Access is temporarily held.', '#f59e0b', '#fffbeb');
    drawConnectorDown(doc, 297, 426, 14);

    drawFlowStep(doc, 52, 442, 490, 48, 4, 'Sole Administrator Approves Operator Account', 'Administrator logs in, verifies the application under User Management, and clicks "Approve". Initial Free Editing Window is assigned.', '#10b981', '#ecfdf5');
    drawConnectorDown(doc, 297, 492, 14);

    drawFlowStep(doc, 52, 508, 490, 48, 5, 'Login & Immediate Dashboard Admission', 'Enter Gmail and password under "Sign In" tab (or click "Continue with Google"). Full operator dashboard loads with assigned accounts.', '#4f46e5');

    doc.fillColor('#64748b').fontSize(8).font('Helvetica-Bold')
       .text('VERIFIED GOOGLE AUTHENTICATION ACTIVE • BCrypt Password Protection • Zero Plain-Text Storage', 52, 574, { width: 490, align: 'center' });

    // KPI Cards Reference Box
    drawCard(doc, 36, 630, 523, 164, 'OPERATOR DASHBOARD: 4 PRIMARY KPI METRICS', '#cbd5e1', '#f8fafc');
    
    // 4 KPI Mini Boxes
    const kpiData = [
        ['ACTIVE ACCOUNTS', 'Live Operational Profiles', '#10b981'],
        ['TOTAL POINTS', 'Aggregated Balance', '#0284c7'],
        ['PENDING REQUESTS', 'Open Tickets / Windows', '#f59e0b'],
        ['ELIGIBLE REWARDS', 'Unlocked Vouchers', '#8b5cf6']
    ];
    kpiData.forEach((k, i) => {
        const kX = 52 + (i * 123);
        doc.roundedRect(kX, 656, 115, 60, 4).fill('#ffffff').strokeColor(k[2]).lineWidth(1).stroke();
        doc.fillColor(k[2]).fontSize(8).font('Helvetica-Bold').text(k[0], kX + 6, 664, { width: 103, align: 'center' });
        doc.fillColor('#0f172a').fontSize(14).font('Helvetica-Bold').text('LIVE', kX + 6, 678, { width: 103, align: 'center' });
        doc.fillColor('#64748b').fontSize(7).font('Helvetica').text(k[1], kX + 6, 696, { width: 103, align: 'center' });
    });

    doc.fillColor('#334155').fontSize(8).font('Helvetica')
       .text('All metrics recalculate dynamically in real time when account status, points tallies, or redemptions update.', 52, 730, { width: 490 });

    drawPageFooter(doc);

    // ==========================================
    // PAGE 2: Full Account Data Ingestion Pipeline
    // ==========================================
    doc.addPage({ margin: 36, size: 'A4' });
    drawPageHeader(doc, 2, 'Account Ingestion: 9-Column Excel/Sheets Setup', 'Operator & User Manual');

    // Top pipeline flow
    drawCard(doc, 36, 68, 523, 110, 'BULK SPREADSHEET INGESTION PIPELINE (EXCEL / CSV)', '#4f46e5', '#eef2ff');
    drawFlowStep(doc, 48, 92, 115, 48, 1, 'Format Sheet', 'Prepare Excel / CSV file with 9 standard headers', '#4f46e5');
    drawConnectorRight(doc, 165, 116, 14);
    drawFlowStep(doc, 181, 92, 115, 48, 2, 'Sample CSV', 'Click "Upload Excel" > Download Sample Template', '#0284c7');
    drawConnectorRight(doc, 298, 116, 14);
    drawFlowStep(doc, 314, 92, 115, 48, 3, 'Import Data', 'Select file & upload during Free Editing Period', '#f59e0b');
    drawConnectorRight(doc, 431, 116, 14);
    drawFlowStep(doc, 447, 92, 100, 48, 4, 'Auto-Binding', 'Accounts bound to your profile', '#10b981');

    doc.fillColor('#4338ca').fontSize(7.5).font('Helvetica-Bold')
       .text('Note: Operators can import all accounts at the start during their active Free Editing Window or with import permission.', 48, 150, { width: 495 });

    // Master 12-Column Specification Table
    doc.fillColor('#0f172a').fontSize(11).font('Helvetica-Bold')
       .text('MASTER SPREADSHEET SCHEMA: COMPREHENSIVE CREDENTIALS & FIELDS', 36, 184);

    const schemaHeaders = ['Column Header', 'Req?', 'Example Value', 'Maps to UI Field in Account Details'];
    const schemaWidths = [120, 35, 160, 190];
    const schemaRows = [
        { cols: ['profile_no', 'Yes', '001 (or 089, 230)', 'Section A: Profile Number (3-digit formatted 001)'], bold: true },
        { cols: ['email', 'Yes', 'operator.acc1@gmail.com', 'Section A & B: Primary Email / Outlook Identifier'], bold: true },
        { cols: ['email_password', 'No', 'AlphaPass!9', 'Section B: Email / Outlook Password (Plaintext)'], bold: false },
        { cols: ['server', 'Yes', 'US-AZ#146', 'Section A & B: Server Information (Proxy Tag)'], bold: true },
        { cols: ['proton_email', 'No', 'secure.acc@proton.me', 'Section B: Proton Mail Address'], bold: false },
        { cols: ['proton_password', 'No', 'ProtSecret#4', 'Section B: Proton Mail Password (Plaintext)'], bold: false },
        { cols: ['alternative_email', 'No', 'recovery@domain.com', 'Section B: Alternative / Recovery Mail'], bold: false },
        { cols: ['alternative_password', 'No', 'RecPass*2', 'Section B: Alternative Mail Password (Plaintext)'], bold: false },
        { cols: ['current_points', 'No', '5000', 'Account Table: Current Points Ledger'], bold: false },
        { cols: ['classification', 'No', 'old (or new)', 'Section A: Classification Badge (Old / New)'], bold: false },
        { cols: ['status', 'No', 'active (or banned)', 'Section A: Status Badge (Active / Banned)'], bold: false },
        { cols: ['notes', 'No', 'US proxy rotation slot #1', 'Section A: Account Notes Box'], bold: false }
    ];

    const tableEndY = drawDiagramTable(doc, 36, 200, 523, schemaHeaders, schemaRows, schemaWidths, 15, 16);

    // Section A vs Section B Visual Mockup Box
    drawCard(doc, 36, tableEndY + 8, 523, 140, 'UI FIELD CORRESPONDENCE: DEDICATED ACCOUNT DOSSIER', '#cbd5e1', '#ffffff');

    // Section A Sub-card
    doc.roundedRect(48, tableEndY + 28, 240, 95, 4).fill('#f8fafc').strokeColor('#cbd5e1').lineWidth(0.75).stroke();
    doc.fillColor('#4f46e5').fontSize(8.5).font('Helvetica-Bold').text('Section A: Account Overview', 58, tableEndY + 34);
    
    const secAItems = [
        ['Profile Number:', '3-digit zero-padded (001, 002, 089)'],
        ['Email / Outlook:', 'Primary account identifier'],
        ['Server:', 'Bound proxy host / tag'],
        ['Status & Class:', 'ACTIVE/BANNED and OLD/NEW badges'],
        ['Account Notes:', 'Freeform operational notes']
    ];
    let aY = tableEndY + 48;
    secAItems.forEach(([lbl, desc]) => {
        doc.fillColor('#0f172a').fontSize(7).font('Helvetica-Bold').text(lbl, 58, aY, { width: 85 });
        doc.fillColor('#64748b').fontSize(7).font('Helvetica').text(desc, 145, aY, { width: 135 });
        aY += 12;
    });

    // Section B Sub-card
    doc.roundedRect(300, tableEndY + 28, 245, 95, 4).fill('#f8fafc').strokeColor('#cbd5e1').lineWidth(0.75).stroke();
    doc.fillColor('#10b981').fontSize(8.5).font('Helvetica-Bold').text('Section B: Credentials & Passwords (Plaintext)', 310, tableEndY + 34);

    const secBItems = [
        ['Email & Password:', 'Plaintext password with copy & eye toggle'],
        ['Proton & Password:', 'Proton mail & plaintext password'],
        ['Alt Mail & Pass:', 'Optional recovery mail & password'],
        ['Server / Proxy:', 'Server tag with 1-click copy']
    ];
    let bY = tableEndY + 48;
    secBItems.forEach(([lbl, desc]) => {
        doc.fillColor('#0f172a').fontSize(7).font('Helvetica-Bold').text(lbl, 310, bY, { width: 95 });
        doc.fillColor('#64748b').fontSize(7).font('Helvetica').text(desc, 408, bY, { width: 130 });
        bY += 12;
    });

    doc.fillColor('#0f172a').fontSize(7.5).font('Helvetica-Bold')
       .text('Result: Uploading all credentials via spreadsheet populates both Section A and Section B completely with no empty "-" fields.', 48, tableEndY + 126, { width: 495 });

    drawPageFooter(doc);

    // ==========================================
    // PAGE 3: Free Editing Period & Read-Only States
    // ==========================================
    doc.addPage({ margin: 36, size: 'A4' });
    drawPageHeader(doc, 3, 'Governance: Free Editing Period & Protection States', 'Operator & User Manual');

    // State machine flowchart
    drawCard(doc, 36, 68, 523, 270, 'STATE MACHINE: FREE EDITING PERIOD VS READ-ONLY LOCK', '#4f46e5', '#f8fafc');

    // State 1: Active
    doc.roundedRect(52, 94, 220, 110, 6).fill('#ecfdf5').strokeColor('#10b981').lineWidth(1.5).stroke();
    doc.fillColor('#065f46').fontSize(10).font('Helvetica-Bold').text('STATE 1: FREE EDITING ACTIVE', 64, 104);
    doc.fillColor('#10b981').fontSize(8.5).font('Courier-Bold').text('[⏱️ Free Editing: 18h 45m remaining]', 64, 120);
    
    doc.fillColor('#1e293b').fontSize(7.5).font('Helvetica')
       .text('• Full Write Permissions Enabled\n• "+ Add Account" toolbar button active\n• "Edit" button enabled on all rows\n• "Upload Excel" enabled for bulk import', 64, 138, { lineGap: 2 });

    // Transition Arrow (Timer expires)
    drawConnectorRight(doc, 274, 149, 40, 'Timer = 0:00');

    // State 2: Read-Only Locked
    doc.roundedRect(316, 94, 225, 110, 6).fill('#fffbeb').strokeColor('#f59e0b').lineWidth(1.5).stroke();
    doc.fillColor('#92400e').fontSize(10).font('Helvetica-Bold').text('STATE 2: READ-ONLY PROTECTED', 328, 104);
    doc.fillColor('#b45309').fontSize(8.5).font('Courier-Bold').text('[🔒 Locked: Read-Only Mode]', 328, 120);

    doc.fillColor('#1e293b').fontSize(7.5).font('Helvetica')
       .text('• Write buttons securely locked\n• Protects accounts from accidental overwrite\n• Data fully readable & exportable\n• Unlock via Request Center ticket', 328, 138, { lineGap: 2 });

    // Unlock Loop Arrow back to State 1
    doc.moveTo(428, 206).lineTo(428, 240).lineTo(162, 240).lineTo(162, 206).strokeColor('#4f46e5').lineWidth(1.2).stroke();
    doc.polygon([159, 208], [165, 208], [162, 204]).fill('#4f46e5');
    doc.fillColor('#4f46e5').fontSize(8).font('Helvetica-Bold')
       .text('Admin Approves Request Center Ticket -> Timer Restarts (State 1 Resumes)', 175, 244);

    // FLOWCHART: Request Center Ticket Submission
    drawCard(doc, 36, 350, 523, 275, 'FLOWCHART: REQUESTING AN EDITING WINDOW OR CORRECTION', '#cbd5e1', '#ffffff');

    drawFlowStep(doc, 52, 374, 490, 42, 1, 'Navigate to Request Center', 'Click "Request Center" in the sidebar navigation and click the blue "+ New Request" button.', '#4f46e5');
    drawConnectorDown(doc, 297, 418, 12);

    drawFlowStep(doc, 52, 432, 490, 42, 2, 'Select Ticket Category & Specify Reason', 'Choose "Account Correction" (to fix proxy/server) or "Points Update Window" (to tally points).', '#4f46e5');
    drawConnectorDown(doc, 297, 476, 12);

    drawFlowStep(doc, 52, 490, 490, 42, 3, 'Administrator Receives Real-Time Alert', 'Notification arrives on the Administrator Notification Center. Admin can inspect details and rationale.', '#f59e0b');
    drawConnectorDown(doc, 297, 534, 12);

    drawFlowStep(doc, 52, 548, 490, 42, 4, 'One-Click Admin Approval & Immediate Unlock', 'When approved, changes are automatically committed or your Free Editing countdown badge unlocks instantly.', '#10b981');

    // Real-World Example Box
    drawCard(doc, 36, 636, 523, 158, 'REAL-WORLD REQUEST TICKETS EXAMPLES', '#cbd5e1', '#f8fafc');

    // Example 1
    doc.roundedRect(48, 660, 240, 95, 4).fill('#ffffff').strokeColor('#cbd5e1').lineWidth(0.75).stroke();
    doc.fillColor('#0284c7').fontSize(8.5).font('Helvetica-Bold').text('Example A: Account Correction Ticket', 56, 668);
    doc.fillColor('#334155').fontSize(7.5).font('Helvetica')
       .text('Type: Account Correction\nAccount: rathantata51@gmail.com\nSubject: Rotate Proxy Exit Node\nDetails: Please update server proxy from US-AZ#146 to US-CA#102 due to IP maintenance.\nStatus: Pending Admin One-Click Commit', 56, 682, { lineGap: 2 });

    // Example 2
    doc.roundedRect(302, 660, 243, 95, 4).fill('#ffffff').strokeColor('#cbd5e1').lineWidth(0.75).stroke();
    doc.fillColor('#10b981').fontSize(8.5).font('Helvetica-Bold').text('Example B: Points Window Request', 310, 668);
    doc.fillColor('#334155').fontSize(7.5).font('Helvetica')
       .text('Type: Points Update Window\nDuration: 2 Hours\nSubject: Monthly Batch Points Sync\nDetails: Updating month-end points for assigned farm profiles P1 to P20.\nStatus: Timer starts immediately upon approval', 310, 682, { lineGap: 2 });

    drawPageFooter(doc);

    // ==========================================
    // PAGE 4: Points, Rewards & Periodic Review
    // ==========================================
    doc.addPage({ margin: 36, size: 'A4' });
    drawPageHeader(doc, 4, 'Points, Rewards & Periodic Review Governance', 'Operator & User Manual');

    // Points & Rewards Lifecycle
    drawCard(doc, 36, 68, 523, 160, 'POINTS & REWARD REDEMPTION LIFECYCLE', '#4f46e5', '#eef2ff');
    drawFlowStep(doc, 48, 92, 115, 60, 1, 'Earn Points', 'Managed accounts accumulate points from activity', '#4f46e5');
    drawConnectorRight(doc, 165, 122, 14);
    drawFlowStep(doc, 181, 92, 115, 60, 2, 'Browse Catalog', 'Check Available Rewards & point thresholds (e.g. 10k)', '#0284c7');
    drawConnectorRight(doc, 298, 122, 14);
    drawFlowStep(doc, 314, 92, 115, 60, 3, 'Claim Voucher', 'Click "Redeem Reward" on qualifying profiles', '#f59e0b');
    drawConnectorRight(doc, 431, 122, 14);
    drawFlowStep(doc, 447, 92, 100, 60, 4, 'Fulfillment', 'Admin fulfills gift card or payment', '#10b981');

    doc.fillColor('#334155').fontSize(8).font('Helvetica')
       .text('Track your submitted redemptions and disbursement codes directly under "Request Center > My Requests".', 48, 160, { width: 495 });

    // PERIODIC REVIEW FORM: ADMIN DISPATCHED FLOW
    drawCard(doc, 36, 240, 523, 380, 'PERIODIC REVIEW FORM: ADMIN-DISPATCHED GATING FLOW', '#cbd5e1', '#ffffff');

    doc.fillColor('#b45309').fontSize(8.5).font('Helvetica-Bold')
       .text('CRITICAL NOTICE: The review form NEVER pops up automatically. It ONLY appears when Admin specifically sends it.', 52, 260);

    drawFlowStep(doc, 52, 280, 490, 44, 1, 'Normal Operation: Dashboard Fully Active', 'Operator works seamlessly without interruptions. The review form is dormant and hidden.', '#10b981', '#ecfdf5');
    drawConnectorDown(doc, 297, 326, 12);

    drawFlowStep(doc, 52, 340, 490, 44, 2, 'Administrator Dispatches Review Form to Operator', 'Administrator clicks "Send Form" in Monthly Reviews. Socket event notifies your session instantly.', '#f59e0b', '#fffbeb');
    drawConnectorDown(doc, 297, 386, 12);

    drawFlowStep(doc, 52, 400, 490, 44, 3, 'Dashboard Stops Displaying (Review Gate Active)', 'Full-screen review overlay appears. Dashboard access is temporarily held until review completion.', '#dc2626', '#fef2f2');
    drawConnectorDown(doc, 297, 446, 12);

    drawFlowStep(doc, 52, 460, 490, 44, 4, 'Operator Completes 4 Verification Questions', '1. Registered account review?  2. Records accurate?  3. Status changes?  4. Points up to date?', '#4f46e5', '#ffffff');
    drawConnectorDown(doc, 297, 506, 12);

    drawFlowStep(doc, 52, 520, 490, 44, 5, 'Click "Submit & Unlock": Dashboard Resumes Instantly!', 'Review flag resets to 0. The review gate closes and your normal dashboard resumes displaying immediately.', '#10b981', '#ecfdf5');

    doc.fillColor('#64748b').fontSize(7.5).font('Helvetica')
       .text('Admin Override: The Administrator can also click "Cancel & Resume Dashboard" to lift the requirement at any time.', 52, 580, { width: 490 });

    // Export Reports Card
    drawCard(doc, 36, 632, 523, 162, 'SELF-SERVICE REPORT EXPORTS (CSV)', '#cbd5e1', '#f8fafc');
    doc.fillColor('#334155').fontSize(8).font('Helvetica')
       .text('Navigate to "Download Reports" to export your assigned accounts, points balances, and redemption history as a timestamped CSV spreadsheet for offline analysis.\n\nPasswords and sensitive authentication tokens are strictly stripped to maintain zero-trust security compliance.', 52, 656, { width: 490, lineGap: 3 });

    drawPageFooter(doc);

    // ==========================================
    // PAGE 5: Quick Reference & Troubleshooting
    // ==========================================
    doc.addPage({ margin: 36, size: 'A4' });
    drawPageHeader(doc, 5, 'Quick Reference & Troubleshooting Decision Tree', 'Operator & User Manual');

    // Troubleshooting Decision Tree Box
    drawCard(doc, 36, 68, 523, 400, 'TROUBLESHOOTING DECISION TREE', '#cbd5e1', '#ffffff');

    const issues = [
        {
            q: 'Issue 1: "Sign In" button reloads page or does nothing',
            cause: 'Browser cache running older JavaScript version.',
            sol: 'Perform a hard reload: Press Ctrl + F5 (Windows) or Cmd + Shift + R (Mac). Authentication is direct and asynchronous.'
        },
        {
            q: 'Issue 2: "Application Submitted: Pending Review" appears',
            cause: 'Enterprise access control requires administrator authorization.',
            sol: 'Notify administrator (001.workme@gmail.com) to approve your application under User Management.'
        },
        {
            q: 'Issue 3: "+ Add Account" and "Edit" buttons are locked',
            cause: 'Your Free Editing Period has expired and portfolio is in Read-Only Mode.',
            sol: 'Go to Request Center > click "+ New Request" > submit an "Account Correction" or "Points Window" request.'
        },
        {
            q: 'Issue 4: Account Details fields show "-" (empty)',
            cause: 'Spreadsheet uploaded was missing optional columns (recovery, proton, notes).',
            sol: 'Download the 9-column sample template from "Upload Excel" and re-import with all fields populated.'
        },
        {
            q: 'Issue 5: Review Form appears and blocks dashboard',
            cause: 'Administrator dispatched a periodic compliance review to your profile.',
            sol: 'Answer the 4 simple verification questions and click "Submit & Unlock Dashboard" to immediately resume.'
        }
    ];

    let tY = 92;
    issues.forEach((iss, i) => {
        doc.roundedRect(48, tY, 498, 54, 4).fill('#f8fafc').strokeColor('#cbd5e1').lineWidth(0.5).stroke();
        doc.fillColor('#dc2626').fontSize(8.5).font('Helvetica-Bold').text(iss.q, 56, tY + 6);
        doc.fillColor('#64748b').fontSize(7.5).font('Helvetica').text(`Cause: ${iss.cause}`, 56, tY + 20);
        doc.fillColor('#10b981').fontSize(7.5).font('Helvetica-Bold').text(`Solution: ${iss.sol}`, 56, tY + 34, { width: 480 });
        tY += 60;
    });

    // Daily & Monthly Operator Checklist Table
    doc.fillColor('#0f172a').fontSize(11).font('Helvetica-Bold')
       .text('OPERATOR DAILY & MONTHLY CHECKLIST', 36, 482);

    const checkHeaders = ['Frequency', 'Routine Action', 'Target Interface', 'Expected Outcome'];
    const checkWidths = [70, 155, 130, 150];
    const checkRows = [
        { cols: ['Daily', 'Verify Active Accounts Health', 'Active Accounts Table', 'Flag any proxy or server dropouts'], bold: true },
        { cols: ['Weekly', 'Review Points Ledger Tally', 'Points Ledger Tab', 'Ensure accumulated points match activity'], bold: false },
        { cols: ['As Needed', 'Submit Correction Requests', 'Request Center', 'Rotate server proxy or update recovery email'], bold: false },
        { cols: ['When Eligible', 'Redeem Unlocked Vouchers', 'Available Rewards', 'Submit claim for admin fulfillment'], bold: false },
        { cols: ['Admin Prompt', 'Complete Periodic Review Form', 'Review Gate Overlay', 'Confirm records accurate to resume dashboard'], bold: true }
    ];

    const checkEndY = drawDiagramTable(doc, 36, 498, 523, checkHeaders, checkRows, checkWidths);

    // Support & Governance Card
    drawCard(doc, 36, checkEndY + 12, 523, 110, 'SECURITY & SUPPORT CONTACT', '#4f46e5', '#eef2ff');
    doc.fillColor('#334155').fontSize(8).font('Helvetica')
       .text('• Sole Administrator: 001.workme@gmail.com\n• Production URL: https://pointpulse-8bbn.onrender.com\n• Support & Requests: In-App Request Center ("Contact Administrator" modal)\n• Security Compliance: Zero-Password Storage Policy • BCrypt Salt Rounds: 10 • Role-Based Data Isolation', 52, checkEndY + 36, { lineGap: 3 });

    drawPageFooter(doc);

    finalizeDoc(doc, 'Operator & User Manual');
    doc.end();

    return new Promise(resolve => writeStream.on('finish', resolve));
}

// -----------------------------------------------------------------------------
// 2. ADMINISTRATOR OPERATING MANUAL (EXACTLY 5 PAGES)
// -----------------------------------------------------------------------------
async function buildAdminManual() {
    const doc = new PDFDocument({ margin: 36, size: 'A4', autoFirstPage: false });
    const pdfPath = path.join(outDir, 'PointPulse_Administrator_Manual.pdf');
    const writeStream = fs.createWriteStream(pdfPath);
    doc.pipe(writeStream);

    // ==========================================
    // PAGE 1: Single-Administrator Governance
    // ==========================================
    doc.addPage({ margin: 36, size: 'A4' });
    drawPageHeader(doc, 1, 'Single-Administrator Governance & Architecture', 'Administrator Manual');

    // Architecture Overview Card
    drawCard(doc, 36, 68, 523, 175, 'SINGLE-ADMINISTRATOR GOVERNANCE ARCHITECTURE', '#4f46e5', '#eef2ff', '#3730a3');

    // Central admin node
    drawFlowStep(doc, 185, 92, 190, 55, 1, 'Sole Platform Administrator', 'Hardcoded Email: 001.workme@gmail.com\nZero Secondary Administrators Rule', '#4f46e5', '#ffffff');

    // 4 Branch Nodes radiating from Admin
    drawFlowStep(doc, 48, 165, 115, 60, 2, 'User Approvals', 'Approve/reject operators & set permissions', '#0284c7');
    drawFlowStep(doc, 176, 165, 115, 60, 3, 'Portfolio Control', 'Assign all/single accounts to operators', '#10b981');
    drawFlowStep(doc, 304, 165, 115, 60, 4, 'Review Dispatch', 'Lock/resume operator dashboards on demand', '#f59e0b');
    drawFlowStep(doc, 432, 165, 115, 60, 5, 'Security & Audit', 'Executive PDF reports & tamper logs', '#8b5cf6');

    // FLOWCHART: Admin Authentication & Console Admission
    drawCard(doc, 36, 255, 523, 380, 'AUTHENTICATION FLOWCHART: DUAL-METHOD VERIFICATION', '#cbd5e1', '#ffffff');

    drawFlowStep(doc, 52, 280, 490, 48, 1, 'Access PointPulse Production Console', 'Open https://pointpulse-8bbn.onrender.com. The secure authentication card displays dual-tab options.', '#4f46e5');
    drawConnectorDown(doc, 297, 330, 14);

    drawFlowStep(doc, 52, 346, 490, 48, 2, 'Select Sign-In Method (Direct Email or Google OAuth)', 'Method A: Enter 001.workme@gmail.com & admin password.\nMethod B: Click "Continue with Google" while logged into 001.workme@gmail.com.', '#4f46e5');
    drawConnectorDown(doc, 297, 396, 14);

    drawFlowStep(doc, 52, 412, 490, 48, 3, 'Identity Verification & Role Privilege Check', 'Backend validates token against hardcoded sole admin constraint. Zero secondary promotions allowed.', '#10b981');
    drawConnectorDown(doc, 297, 462, 14);

    drawFlowStep(doc, 52, 478, 490, 48, 4, 'Full Enterprise Administrator Console Loads', 'Admin navigation is unlocked: Overview KPIs, User Management, All Accounts, Old/New Board, Catalog, Reviews, Downloads, Audit.', '#4f46e5');

    doc.fillColor('#64748b').fontSize(8).font('Helvetica-Bold')
       .text('IMMUTABLE SINGLE-ADMIN SECURITY: No user can self-promote or be promoted to administrator.', 52, 545, { width: 490, align: 'center' });

    // Primary Operator Profile Box
    drawCard(doc, 36, 646, 523, 150, 'PRIMARY OPERATOR CONFIGURATION (laptopmew1@gmail.com)', '#cbd5e1', '#f8fafc');
    doc.fillColor('#334155').fontSize(8).font('Helvetica')
       .text('• Designated Primary Operator: laptopmew1@gmail.com (Madhu G)\n• Initial Status: Approved Operator with full permissions (Add Accounts, Edit, Import Excel, Update Points)\n• Account Attribution: All unassigned accounts automatically resolve to laptopmew1@gmail.com\n• Dossier Access: Open User Management > Details to inspect portfolio, redemptions, and activity logs.', 52, 672, { width: 490, lineGap: 3 });

    drawPageFooter(doc);

    // ==========================================
    // PAGE 2: User Onboarding & Granular Permissions
    // ==========================================
    doc.addPage({ margin: 36, size: 'A4' });
    drawPageHeader(doc, 2, 'User Onboarding, Approvals & Granular Permissions', 'Administrator Manual');

    // FLOWCHART: Operator Approval Lifecycle
    drawCard(doc, 36, 68, 523, 310, 'OPERATOR APPLICATION & APPROVAL LIFECYCLE', '#4f46e5', '#f8fafc');

    drawFlowStep(doc, 52, 92, 490, 42, 1, 'Applicant Registers on Login Portal', 'New user submits name, Gmail, and password. Account enters "pending" status.', '#4f46e5');
    drawConnectorDown(doc, 297, 136, 12);

    drawFlowStep(doc, 52, 150, 490, 42, 2, 'Inspect Application in User Management', 'Navigate to "User Management". Inspect Pending Approvals queue, applicant name, and timestamp.', '#0284c7');
    drawConnectorDown(doc, 297, 194, 12);

    drawFlowStep(doc, 52, 208, 490, 42, 3, 'Click "Approve" (or "Reject" to Purge)', 'Clicking Approve sets status to ACTIVE and automatically provisions initial Free Editing Window.', '#10b981');
    drawConnectorDown(doc, 297, 252, 12);

    drawFlowStep(doc, 52, 266, 490, 42, 4, 'Operator Gains Access to Assigned Workspace', 'Operator signs in immediately. Access is restricted exclusively to their assigned accounts.', '#4f46e5');

    // Granular Permissions Table
    doc.fillColor('#0f172a').fontSize(11).font('Helvetica-Bold')
       .text('GRANULAR OPERATOR PERMISSIONS MATRIX', 36, 390);

    const permHeaders = ['Permission Key', 'Default', 'Function & Capability Controlled', 'Security Risk Level'];
    const permWidths = [120, 50, 240, 95];
    const permRows = [
        { cols: ['view_accounts', 'Granted', 'View assigned accounts list and details dossier', 'Low (Isolated)'], bold: true },
        { cols: ['add_accounts', 'Granted', 'Create single accounts during active editing periods', 'Low (Isolated)'], bold: false },
        { cols: ['edit_accounts', 'Granted', 'Modify proxy servers, classification, and notes', 'Medium'], bold: false },
        { cols: ['import_excel', 'Granted', 'Bulk upload spreadsheets of accounts and points', 'Medium'], bold: false },
        { cols: ['update_points', 'Window', 'Manually update points balances (requires active window)', 'High'], bold: true },
        { cols: ['view_redemption', 'Granted', 'Browse catalog and submit reward claims', 'Low'], bold: false },
        { cols: ['download_reports', 'Granted', 'Export assigned accounts and points data to CSV', 'Low'], bold: false }
    ];

    const permEndY = drawDiagramTable(doc, 36, 408, 523, permHeaders, permRows, permWidths);

    // Operator Suspension & Lockout Box
    drawCard(doc, 36, permEndY + 12, 523, 140, 'EMERGENCY OPERATOR SUSPENSION & REVOCATION', '#dc2626', '#fef2f2', '#991b1b');
    doc.fillColor('#334155').fontSize(8).font('Helvetica')
       .text('1. Immediate Session Termination: In User Management, click "Suspend" on any operator row.\n2. API Invalidation: The user\'s JWT token and active session are instantly invalidated.\n3. Screen Lockout: Next API call or page refresh returns HTTP 403 Suspended and ejects user to login.\n4. Reactivation: Admin can click "Reactivate" at any time to restore access seamlessly.', 52, permEndY + 36, { lineGap: 3 });

    drawPageFooter(doc);

    // ==========================================
    // PAGE 3: Portfolio Ownership & Bulk Assignment
    // ==========================================
    doc.addPage({ margin: 36, size: 'A4' });
    drawPageHeader(doc, 3, 'Portfolio Ownership & Bulk Assignment ("Assign All")', 'Administrator Manual');

    // Portfolio Map Card
    drawCard(doc, 36, 68, 523, 145, 'MASTER ACCOUNT PORTFOLIO STRUCTURE', '#4f46e5', '#eef2ff');
    drawFlowStep(doc, 50, 92, 140, 52, 1, 'Supabase Accounts', 'Master Pool: 230+ accounts\nProfiles P1 through P230', '#0284c7');
    drawConnectorRight(doc, 192, 118, 24);
    drawFlowStep(doc, 218, 92, 150, 52, 2, 'account_metadata', 'Mapping Table: account_id -> user_id\nDefault owner: laptopmew1@gmail.com', '#4f46e5');
    drawConnectorRight(doc, 370, 118, 24);
    drawFlowStep(doc, 396, 92, 145, 52, 3, 'Operator Workspace', 'Filtered by user_id\nFull dossier display', '#10b981');

    doc.fillColor('#334155').fontSize(8).font('Helvetica')
       .text('The "Assigned Operator" column in All Accounts displays the owner of every profile. Use "Filter by Operator" to isolate accounts.', 50, 156, { width: 495 });

    // FLOWCHART: One-Click Bulk Migration ("Assign All to User")
    drawCard(doc, 36, 224, 523, 310, 'FLOWCHART: BULK REASSIGNMENT ("ASSIGN ALL TO USER")', '#cbd5e1', '#ffffff');

    drawFlowStep(doc, 52, 248, 490, 42, 1, 'Click "Assign All to User" Button', 'Located on the All Accounts toolbar (or in the Individual User Dossier header).', '#4f46e5');
    drawConnectorDown(doc, 297, 292, 12);

    drawFlowStep(doc, 52, 306, 490, 42, 2, 'Select Target Operator Profile', 'Choose target user: laptopmew1@gmail.com (Madhu G) in the confirmation dialog.', '#0284c7');
    drawConnectorDown(doc, 297, 350, 12);

    drawFlowStep(doc, 52, 364, 490, 42, 3, 'Atomic Database Reassignment', 'System updates account_metadata for all profiles and seeds any missing remote Supabase accounts.', '#f59e0b');
    drawConnectorDown(doc, 297, 408, 12);

    drawFlowStep(doc, 52, 422, 490, 42, 4, '100% of Accounts Assigned & Bound', 'Operator dossier updates to show all managed profiles, active accounts, and points ledger.', '#10b981');

    doc.fillColor('#64748b').fontSize(8).font('Helvetica-Bold')
       .text('TRANSACTION LOGGED: Bulk assignment is recorded in the immutable audit log with actor ID and timestamp.', 52, 480, { width: 490, align: 'center' });

    // Single Account Reassignment Card
    drawCard(doc, 36, 545, 523, 245, 'REASSIGNING INDIVIDUAL ACCOUNTS', '#cbd5e1', '#f8fafc');
    doc.fillColor('#334155').fontSize(8).font('Helvetica')
       .text('To move a single account between operators:\n1. Open "All Accounts" in the left sidebar.\n2. Search or filter to find the account row and click the "Edit" button.\n3. Locate the "Assign Operator" dropdown and select the new operator email (e.g. laptopmew1@gmail.com).\n4. Click "Save Changes". The profile and its points ledger move immediately to the selected user.', 52, 570, { width: 490, lineGap: 3 });

    drawPageFooter(doc);

    // ==========================================
    // PAGE 4: Review Dispatch & Free Editing Timers
    // ==========================================
    doc.addPage({ margin: 36, size: 'A4' });
    drawPageHeader(doc, 4, 'Periodic Review Dispatch & Free Editing Governance', 'Administrator Manual');

    // Admin Review Dispatch Flowchart
    drawCard(doc, 36, 68, 523, 310, 'ADMIN-CONTROLLED REVIEW FORM DISPATCHING & GATING', '#4f46e5', '#f8fafc');

    drawFlowStep(doc, 52, 92, 490, 42, 1, 'Admin Decides When to Send Review Form', 'Navigate to "Monthly Reviews" (or User Management). The form does not send automatically.', '#4f46e5');
    drawConnectorDown(doc, 297, 136, 12);

    drawFlowStep(doc, 52, 150, 490, 42, 2, 'Click "Send Form" (Single User) or "Send Form to All"', 'Clicking Send Form flags review_form_required = 1 and emits a real-time notification socket event.', '#f59e0b');
    drawConnectorDown(doc, 297, 194, 12);

    drawFlowStep(doc, 52, 208, 490, 42, 3, 'Operator Dashboard Stops Displaying (Locked)', 'The operator\'s screen immediately presents the review overlay, holding dashboard access.', '#dc2626');
    drawConnectorDown(doc, 297, 252, 12);

    drawFlowStep(doc, 52, 266, 490, 42, 4, 'Operator Submits -> Dashboard Resumes Instantly!', 'Once submitted, operator access unlocks immediately. Submission appears in Review History for admin review.', '#10b981');

    doc.fillColor('#4338ca').fontSize(8).font('Helvetica-Bold')
       .text('ADMIN CANCEL OVERRIDE: Click "Cancel & Resume Dashboard" at any time to lift gating without submission.', 52, 324, { width: 490, align: 'center' });

    // Free Editing Period Controls Box
    drawCard(doc, 36, 390, 523, 200, 'FREE EDITING PERIOD & DURATION GOVERNANCE', '#cbd5e1', '#ffffff');
    doc.fillColor('#334155').fontSize(8).font('Helvetica')
       .text('Configure editing window rules by clicking "Free Editing Periods" on the All Accounts toolbar:\n\n• Global Default Duration: Set the standard window (e.g. 24 Hours, 48 Hours, or 7 Days) automatically granted to newly approved operators upon registration.\n• Auto-Start on Approval: Toggle whether new operators automatically start their timer upon approval.\n• Custom Extension: Select any operator (e.g. laptopmew1@gmail.com) and grant a customized window (e.g. 12 Hours) to allow spreadsheet uploads or server updates.\n• Emergency Revocation: In "Points & Access", click "Revoke Window" to immediately terminate an open session.', 52, 414, { width: 490, lineGap: 3 });

    // Old / New Board Kanban Reference
    drawCard(doc, 36, 602, 523, 188, 'OLD / NEW ACCOUNT CLASSIFICATION KANBAN BOARD', '#cbd5e1', '#f8fafc');
    doc.fillColor('#334155').fontSize(8).font('Helvetica')
       .text('Navigate to "Old / New Board" to manage account tenure visually:\n\n• Drag-and-Drop: Drag account cards between the OLD ACCOUNTS and NEW ACCOUNTS columns to instantly update tenure in the database.\n• Batch Reclassification: Select multiple accounts using checkboxes and click "Batch Move to OLD" or "Batch Move to NEW".\n• Real-Time Sync: All classification changes immediately reflect across user dashboards and executive PDF reports.', 52, 626, { width: 490, lineGap: 3 });

    drawPageFooter(doc);

    // ==========================================
    // PAGE 5: Rewards, Audits & Google Cloud Setup
    // ==========================================
    doc.addPage({ margin: 36, size: 'A4' });
    drawPageHeader(doc, 5, 'Rewards, Audit Logs & Google Cloud OAuth Setup', 'Administrator Manual');

    // Reward Catalogue Pipeline
    drawCard(doc, 36, 68, 523, 150, 'MASTER REWARD CATALOGUE & REDEMPTION PIPELINE', '#4f46e5', '#eef2ff');
    drawFlowStep(doc, 48, 92, 115, 55, 1, 'Publish Rewards', 'Add vouchers, gift cards, points required & stock', '#4f46e5');
    drawConnectorRight(doc, 165, 120, 14);
    drawFlowStep(doc, 181, 92, 115, 55, 2, 'Account Match', 'System evaluates operator accounts meeting criteria', '#0284c7');
    drawConnectorRight(doc, 298, 120, 14);
    drawFlowStep(doc, 314, 92, 115, 55, 3, 'Operator Claim', 'Operator submits redemption in Available Rewards', '#f59e0b');
    drawConnectorRight(doc, 431, 120, 14);
    drawFlowStep(doc, 447, 92, 100, 55, 4, 'Fulfillment', 'Admin approves & disburses in Matching', '#10b981');

    doc.fillColor('#334155').fontSize(8).font('Helvetica')
       .text('Points are automatically deducted upon administrative approval and fulfillment.', 48, 160, { width: 495 });

    // GOOGLE CLOUD CONSOLE OAUTH CONFIGURATION
    drawCard(doc, 36, 230, 523, 230, 'GOOGLE CLOUD CONSOLE: EXACT OAUTH 2.0 CONFIGURATION', '#cbd5e1', '#ffffff');

    doc.fillColor('#0f172a').fontSize(8.5).font('Helvetica')
       .text('To ensure Google OAuth authentication functions with zero errors on production:', 52, 252);

    const gSteps = [
        ['1. Open Credentials:', 'Navigate to Google Cloud Console → APIs & Services → Credentials.'],
        ['2. Select Client ID:', 'Click Web Client ID: 162534616388-ko0lpc0r6cpor5vb8tv23aodamelv9mv.apps.googleusercontent.com'],
        ['3. Authorized Origins:', 'Under Authorized JavaScript origins, enter: https://pointpulse-8bbn.onrender.com (no trailing slash)'],
        ['4. Authorized Redirects:', 'Under Authorized redirect URIs, add: https://pointpulse-8bbn.onrender.com AND https://pointpulse-8bbn.onrender.com/api/auth/google/callback'],
        ['5. Render Environment:', 'Verify GOOGLE_CLIENT_ID is saved in Render Dashboard Environment Variables.']
    ];
    let gY = 270;
    gSteps.forEach(([lbl, desc]) => {
        doc.fillColor('#4f46e5').fontSize(8).font('Helvetica-Bold').text(lbl, 52, gY, { width: 120 });
        doc.fillColor('#334155').fontSize(8).font('Helvetica').text(desc, 175, gY, { width: 360 });
        gY += 20;
    });

    // Immutable Audit Logs & PDF Downloads
    drawCard(doc, 36, 472, 523, 318, 'AUDIT LOGS & EXECUTIVE PDF REPORT GENERATOR', '#cbd5e1', '#f8fafc');

    doc.fillColor('#0f172a').fontSize(9).font('Helvetica-Bold')
       .text('1. Immutable Append-Only Security Audit Logs (Audit Logs View):', 52, 496);
    doc.fillColor('#334155').fontSize(8).font('Helvetica')
       .text('• Every login, approval, account creation, edit, bulk migration, points change, and review form dispatch is recorded.\n• Each log entry contains exact ISO timestamp, actor ID/email, role, target user, action, and IP address.\n• Logs are append-only and cannot be modified or deleted by any user or administrator.', 52, 510, { width: 490, lineGap: 2 });

    doc.fillColor('#0f172a').fontSize(9).font('Helvetica-Bold')
       .text('2. Executive PDF Report Generation (Download Center View):', 52, 560);
    doc.fillColor('#334155').fontSize(8).font('Helvetica')
       .text('• Generate publication-ready executive PDF reports with KPI summaries, points distribution charts, and account rosters.\n• Passwords and credentials are automatically redacted in compliance with zero-trust security standards.\n• Export full raw account databases to CSV for external archiving or spreadsheet processing.', 52, 574, { width: 490, lineGap: 2 });

    doc.fillColor('#0f172a').fontSize(8.5).font('Helvetica-Bold')
       .text('ADMINISTRATOR EMERGENCY CONTACT & RECOVERY', 52, 630);
    doc.fillColor('#64748b').fontSize(8).font('Helvetica')
       .text('Sole Administrator: 001.workme@gmail.com • Server: Express 5 + SQLite + Supabase\nHosting: Render Web Service (pointpulse-8bbn.onrender.com) • Backup: Supabase Remote PostgreSQL', 52, 646, { lineGap: 2 });

    drawPageFooter(doc);

    finalizeDoc(doc, 'Administrator Manual');
    doc.end();

    return new Promise(resolve => writeStream.on('finish', resolve));
}

// -----------------------------------------------------------------------------
// FINALIZE RUNNING HEADERS & FOOTERS
// -----------------------------------------------------------------------------
function finalizeDoc(doc, manualHeaderTitle) {
    // Pages are already self-contained with exact 5 pages!
}

// -----------------------------------------------------------------------------
// MAIN EXECUTION
// -----------------------------------------------------------------------------
async function run() {
    console.log('Building 5-Page Diagrammatic Manuals...');
    await buildOperatorManual();
    console.log('✅ Generated: public/downloads/PointPulse_Operator_User_Manual.pdf (5 pages)');
    await buildAdminManual();
    console.log('✅ Generated: public/downloads/PointPulse_Administrator_Manual.pdf (5 pages)');

    // Mirror to root and artifact directories
    const rootDir = path.join(__dirname, '..');
    const artifactDir = 'C:\\Users\\madhu\\.gemini\\antigravity\\brain\\0a00ae4b-20bc-4abd-adcd-09b993cdefe4';

    const pdfFiles = ['PointPulse_Operator_User_Manual.pdf', 'PointPulse_Administrator_Manual.pdf'];
    for (const f of pdfFiles) {
        const src = path.join(outDir, f);
        const destRoot = path.join(rootDir, f);
        fs.copyFileSync(src, destRoot);
        if (fs.existsSync(artifactDir)) {
            const destArtifact = path.join(artifactDir, f);
            fs.copyFileSync(src, destArtifact);
        }
    }
    console.log('✅ Mirrored 5-page PDF manuals to root and artifact directories.');
    console.log('All 5-page diagrammatic manuals successfully generated!');
}

run().catch(err => {
    console.error('Error generating manuals:', err);
    process.exit(1);
});
