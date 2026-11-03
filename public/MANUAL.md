# 📘 PointPulse Enterprise Platform Manual
### Official User & Administrator Operating Guide

---

## 📑 Table of Contents
1. [Platform Overview & Architecture](#1-platform-overview--architecture)
   - [1.1 What is PointPulse?](#11-what-is-pointpulse)
   - [1.2 Roles & Access Boundaries](#12-roles--access-boundaries)
   - [1.3 Security & Zero Plain-Text Password Architecture](#13-security--zero-plain-text-password-architecture)
   - [1.4 Live URL & Supported Environments](#14-live-url--supported-environments)
2. [PART I: Operator & User Manual](#part-i-operator--user-manual)
   - [2.1 Registration & Account Creation](#21-registration--account-creation)
   - [2.2 Signing In (Email/Password & Google OAuth)](#22-signing-in-emailpassword--google-oauth)
   - [2.3 Navigating the Operator Dashboard](#23-navigating-the-operator-dashboard)
   - [2.4 Managing Your Accounts Portfolio](#24-managing-your-accounts-portfolio)
     - [Viewing Account Dossier & Credentials Details](#viewing-account-dossier--credentials-details)
     - [Account Statuses (Active vs. Banned)](#account-statuses-active-vs-banned)
   - [2.5 Adding Accounts to Your Portfolio](#25-adding-accounts-to-your-portfolio)
     - [Method A: Single Account Addition (`+ Add Account`)](#method-a-single-account-addition--add-account)
     - [Method B: Bulk Excel / CSV Upload (`Upload Excel`)](#method-b-bulk-excel--csv-upload-upload-excel)
     - [Sample Spreadsheet Column Specification](#sample-spreadsheet-column-specification)
   - [2.6 Free Editing Period & Read-Only Locking](#26-free-editing-period--read-only-locking)
     - [Understanding the Free Editing Window](#understanding-the-free-editing-window)
     - [Active Countdown Timer Badge](#active-countdown-timer-badge)
     - [What Happens When the Window Expires?](#what-happens-when-the-window-expires)
   - [2.7 Request Center & Permission Requests](#27-request-center--permission-requests)
     - [Submitting an Account Correction Request](#submitting-an-account-correction-request)
     - [Requesting Points Update Windows](#requesting-points-update-windows)
     - [Tracking Request Status](#tracking-request-status)
   - [2.8 Points Management & Performance](#28-points-management--performance)
   - [2.9 Reward Catalogue & Redemption](#29-reward-catalogue--redemption)
     - [Browsing Eligible Rewards](#browsing-eligible-rewards)
     - [Redeeming Rewards](#redeeming-rewards)
   - [2.10 Mandatory Monthly Review Forms](#210-mandatory-monthly-review-forms)
   - [2.11 Exporting Reports & CSVs](#211-exporting-reports--csvs)
3. [PART II: Administrator Operating Manual](#part-ii-administrator-operating-manual)
   - [3.1 Single-Administrator Governance Model](#31-single-administrator-governance-model)
   - [3.2 Administrator Sign In](#32-administrator-sign-in)
   - [3.3 User Management & Approvals Workflow](#33-user-management--approvals-workflow)
     - [Approving Pending Registrations](#approving-pending-registrations)
     - [Rejecting or Suspending Operators](#rejecting-or-suspending-operators)
     - [Configuring Granular Operator Permissions](#configuring-granular-operator-permissions)
   - [3.4 Account Portfolio Ownership & Reassignment](#34-account-portfolio-ownership--reassignment)
     - [The `Assigned Operator` Column](#the-assigned-operator-column)
     - [Filtering Accounts by Operator](#filtering-accounts-by-operator)
     - [Reassigning an Individual Account](#reassigning-an-individual-account)
     - [Bulk Migration: "Assign All to User"](#bulk-migration-assign-all-to-user)
   - [3.5 Configuring Free Editing Periods](#35-configuring-free-editing-periods)
     - [Global vs. User-Specific Durations](#global-vs-user-specific-durations)
     - [Starting or Extending an Editing Window](#starting-or-extending-an-editing-window)
   - [3.6 Old / New Classification Kanban Board](#36-old--new-classification-kanban-board)
   - [3.7 Points & Access Permissions Governance](#37-points--access-permissions-governance)
   - [3.8 Master Reward Catalogue Management](#38-master-reward-catalogue-management)
     - [Adding & Editing Rewards](#adding--editing-rewards)
     - [Approving or Rejecting Redemption Requests](#approving-or-rejecting-redemption-requests)
   - [3.9 Notification Center & Request Approvals](#39-notification-center--request-approvals)
   - [3.10 Monthly Reviews Compliance Oversight](#310-monthly-reviews-compliance-oversight)
   - [3.11 Download Center & Executive PDF Generation](#311-download-center--executive-pdf-generation)
   - [3.12 Immutable Audit Logs](#312-immutable-audit-logs)
   - [3.13 Google Cloud OAuth 2.0 Configuration](#313-google-cloud-oauth-20-configuration)
4. [PART III: Troubleshooting & FAQs](#part-iii-troubleshooting--faqs)

---

# 1. Platform Overview & Architecture

### 1.1 What is PointPulse?
**PointPulse** is an enterprise-grade multi-user performance tracking, account management, and rewards distribution platform. It provides seamless management of hundreds of managed accounts, points tracking, tenure classification, reward fulfillment, and governance reporting.

### 1.2 Roles & Access Boundaries
PointPulse operates under a strict role-based separation of duties:

| Role | Primary Identity | Key Capabilities |
| :--- | :--- | :--- |
| **Administrator** | `001.workme@gmail.com` | Sole platform authority. Full governance over user approvals, account assignment, bulk migrations, editing window rules, reward catalog, audit logs, and PDF executive reports. |
| **Operator / User** | `laptopmew1@gmail.com` and other approved operators | Manages assigned accounts, imports Excel/CSV data during Free Editing Windows, submits correction requests, checks points, redeems rewards, and files monthly review forms. |

```
                       ┌────────────────────────┐
                       │  PointPulse Platform   │
                       └───────────┬────────────┘
                                   │
         ┌─────────────────────────┴─────────────────────────┐
         ▼                                                   ▼
┌──────────────────────────────┐            ┌──────────────────────────────┐
│        Administrator         │            │      Operator / User         │
│    (001.workme@gmail.com)    │            │    (laptopmew1@gmail.com)    │
├──────────────────────────────┤            ├──────────────────────────────┤
│ • Approve / Suspend Users    │            │ • View Assigned Accounts     │
│ • Assign All / Single Accs   │            │ • Add Single / Bulk Accounts │
│ • Set Free Editing Periods   │            │ • Request Corrections        │
│ • Publish Reward Catalog     │            │ • Redeem Rewards             │
│ • Export Executive Reports   │            │ • File Monthly Reviews       │
└──────────────────────────────┘            └──────────────────────────────┘
```

### 1.3 Security & Zero Plain-Text Password Architecture
PointPulse is designed around zero-trust credential hygiene:
- **Zero Plain-Text Passwords**: Passwords for managed accounts are never exposed in user tables, CSV downloads, or audit logs.
- **Bcrypt Direct Authentication**: User and admin login credentials are encrypted using industry-standard `bcrypt` hashing with salt rounds.
- **Strict Data Isolation**: Operators cannot see, query, or edit accounts assigned to other operators.

### 1.4 Live URL & Supported Environments
- **Production Live URL**: `https://pointpulse-8bbn.onrender.com`
- **Supported Browsers**: Google Chrome, Mozilla Firefox, Microsoft Edge, Apple Safari (Desktop & Mobile).

---

# PART I: Operator & User Manual

> This section is for **Operators and Team Members** (such as `laptopmew1@gmail.com`) managing day-to-day accounts.

---

### 2.1 Registration & Account Creation
To join PointPulse as an operator:

1. Open your web browser and navigate to:
   ```
   https://pointpulse-8bbn.onrender.com
   ```
2. On the authentication portal, click the **`Create Account`** tab.
3. Complete the registration form:
   - **Full Name**: Enter your name (e.g., `Laptop Mew`).
   - **Gmail Address**: Enter your active Google or Gmail address (e.g., `laptopmew1@gmail.com`).
   - **Password**: Create a secure password (minimum 6 characters).
   - **Confirm Password**: Re-enter your password to confirm.
4. Click the blue **`Create Account`** button.
5. **Pending Approval Screen**:
   - PointPulse will display a notification:
     > *"Application Submitted: Your account registration is pending review by Administrator (001.workme@gmail.com)."*
   - Your account is now in `pending` status. Once the Administrator approves your application, your login will be immediately enabled.

---

### 2.2 Signing In (Email/Password & Google OAuth)
Once approved by the Administrator, you can sign in using either of two methods:

#### Option A: Direct Email & Password Sign In
1. Navigate to `https://pointpulse-8bbn.onrender.com`.
2. Ensure the **`Sign In`** tab is selected.
3. Enter your registered **Google / Gmail Address** (e.g., `laptopmew1@gmail.com`).
4. Enter your **Password**.
5. Click **`Sign In to PointPulse`**.

#### Option B: Google One-Click OAuth
1. Click the **`Continue with Google`** button below the form.
2. Select your verified Google account from the Google sign-in prompt.
3. PointPulse will authenticate your token and take you straight to your dashboard.

---

### 2.3 Navigating the Operator Dashboard
When you log in, the left sidebar displays your navigation menu:

- **My Overview**: Quick visual summary of your account metrics, total points, pending requests, and eligible rewards.
- **Active Accounts**: Full list of active accounts assigned to your profile.
- **Banned Accounts**: Accounts that are currently flagged or suspended.
- **Old & New Accounts**: Accounts organized by classification category.
- **Available Rewards**: Reward catalog with redemption options.
- **Request Center**: Hub for submitting corrections and points-editing access requests.
- **Download Reports**: Export your account records as CSV.

At the top right of the screen, you will see your **User Email Pill** and the **Editing Window Timer** (when active).

---

### 2.4 Managing Your Accounts Portfolio

#### Viewing Your Account List
Under **Active Accounts**, you will see a table containing all accounts assigned to you:
- **PROF #**: The profile or system number (e.g., `P1`, `P2`, `P3`).
- **ACCOUNT IDENTIFIER**: The email address or identifier of the account.
- **SERVER**: Assigned proxy or region server (e.g., `US-AZ#146`, `US-DC#257`).
- **CURRENT POINTS**: Total accumulated points for this profile.
- **CLASSIFICATION**: `NEW` or `OLD` tenure badge.
- **STATUS**: `ACTIVE` (green badge) or `BANNED` (red badge).
- **ACTIONS**: Action buttons for each row (`Details`, `Points`, `Edit`).

#### Viewing Account Dossier & Credentials Details
Click the **`Details`** button next to any account to open the Account Dossier modal.
The dossier contains three tabs:
1. **Overview**: Account profile number, identifier, server, classification, and creation date.
2. **Credentials & Proxy**: View server location, proxy configuration, and recovery email. *(Note: In accordance with zero-trust security, plain-text passwords are never displayed).*
3. **Activity Logs**: Complete timestamped audit history of changes made to this specific account.

#### Editing Account Information
- During an active **Free Editing Period**, click the **`Edit`** button on any account row.
- You can update the Server, Classification, and Notes.
- Click **Save Changes**.

---

### 2.5 Adding Accounts to Your Portfolio
You can add accounts using either **Single Addition** or **Bulk Excel / CSV Upload**.

> ⚠️ **Note**: Adding and editing accounts is permitted during your **Free Editing Period**. When your window is closed, submit a quick request via the Request Center.

#### Method A: Single Account Addition (`+ Add Account`)
1. On the **Active Accounts** page, click the blue **`+ Add Account`** button in the toolbar.
2. In the modal, fill in:
   - **Profile Number**: Enter `P1`, `P2`, or your internal profile code.
   - **Account Identifier**: Enter the email or unique identifier for the account.
   - **Server / Region**: Enter the server or proxy tag (e.g., `US-NY#101`).
   - **Initial Points**: Enter starting points (default is `0`).
   - **Classification**: Select `NEW` or `OLD`.
3. Click **Save Account**.
4. The account will appear immediately in your list.

#### Method B: Bulk Excel / CSV Upload (`Upload Excel`)
If you have multiple accounts in an Excel or CSV spreadsheet:

1. Click the **`Upload Excel`** button on the toolbar.
2. In the popup, click **`Download Sample CSV`** to review the exact column format required.
3. Prepare your spreadsheet with the required columns.
4. Click **Choose File**, select your `.csv` or `.xlsx` file, and click **`Import Accounts`**.
5. The system will validate all rows and automatically assign the imported accounts to your profile.

#### Sample Spreadsheet Column Specification
Your CSV or Excel file should have the following column headers:

| Header Name | Required? | Example Value | Description |
| :--- | :--- | :--- | :--- |
| `profile_num` | Yes | `P1` | Profile or browser ID |
| `account_identifier` | Yes | `operator.acc1@gmail.com` | Email or account ID |
| `server` | Yes | `US-AZ#146` | Proxy server name |
| `current_points` | No | `5000` | Points balance (default `0`) |
| `classification` | No | `OLD` or `NEW` | Account age / tenure |
| `status` | No | `active` or `banned` | Operational state |

---

### 2.6 Free Editing Period & Read-Only Locking

#### Understanding the Free Editing Window
To ensure data accuracy while preventing unauthorized or accidental changes, PointPulse utilizes a **Free Editing Period**:
- When you register and are approved, the Administrator grants you a Free Editing Window (typically 24 to 48 hours).
- During this window, you can freely add accounts, edit details, upload spreadsheets, and update credentials.

#### Active Countdown Timer Badge
When an editing window is active:
- A glowing green pill appears in the top navigation bar:
  ```
  [⏱️ Free Editing Window: 18h 42m remaining]
  ```
- All action buttons (`+ Add Account`, `Edit`, `Upload Excel`) are unlocked and fully functional.

#### What Happens When the Window Expires?
- Once the timer reaches zero, your dashboard transitions into **Read-Only Mode**.
- Account data is securely locked to protect against unauthorized modifications.
- If you need to make changes, add new accounts, or correct mistakes after the window expires, you can simply request a new window via the **Request Center** (see below).

---

### 2.7 Request Center & Permission Requests

#### Submitting an Account Correction Request
If you need to fix an account error while in Read-Only Mode:
1. Navigate to **`Request Center`** in the sidebar.
2. Click **`+ New Request`**.
3. Under **Request Type**, select **`Account Correction`**.
4. Enter the **Account Identifier** (email) of the affected account.
5. In the **Details / Reason** box, specify the correction (e.g., *"Update server from US-AZ#146 to US-CA#102"*).
6. Click **Submit Request**.
7. The Administrator will receive an instant notification and can approve the correction directly.

#### Requesting Points Update Windows
If you need to adjust points for your accounts:
1. In the **Request Center**, click **`+ New Request`**.
2. Select **`Points Update Window`**.
3. Choose the requested duration (e.g., 2 hours).
4. Provide a brief explanation (e.g., *"Monthly batch points tally"*).
5. Click **Submit**. Upon approval, your editing timer will automatically unlock.

#### Tracking Request Status
- The Request Center table displays the status of all your requests:
  - 🟡 **Pending**: Awaiting Administrator review.
  - 🟢 **Approved**: Request granted / window active.
  - 🔴 **Rejected**: Denied with Administrator feedback.

---

### 2.8 Points Management & Performance
- Points represent performance credits accumulated by each managed account.
- Track individual points per account on the **Active Accounts** page.
- Track total points accumulated across your entire portfolio on the **My Overview** page.
- Points determine your eligibility for rewards in the Master Reward Catalogue.

---

### 2.9 Reward Catalogue & Redemption

#### Browsing Eligible Rewards
1. Navigate to **`Available Rewards`** in the left sidebar.
2. Browse through the available vouchers, gift cards, and rewards.
3. Each reward card displays:
   - **Title & Description**
   - **Points Required** (e.g., `10,000 Points`)
   - **Availability / Stock**
   - **Eligibility Status**:
     - 🟢 **Eligible**: Your active points meet or exceed the required threshold.
     - ⚪ **Locked**: More points needed to unlock.

#### Redeeming Rewards
1. Click **`Redeem Now`** on any eligible reward.
2. Select which assigned account's points should be used for the redemption.
3. Confirm the claim.
4. The request will appear in your **Request Center** and the Administrator will fulfill the reward.

---

### 2.10 Mandatory Monthly Review Forms
At the start of every calendar month:
1. PointPulse prompts you to complete the **Monthly Performance Review Form**.
2. Confirm:
   - Total active accounts in use.
   - Any banned or compromised accounts needing replacement.
   - Performance feedback or server issues.
3. Submit the form.
4. Completing the review ensures your account remains in good standing and eligible for reward disbursements.

---

### 2.11 Exporting Reports & CSVs
1. Navigate to **`Download Reports`** in the sidebar.
2. Click **`Export My Accounts (CSV)`** to download a clean spreadsheet of all your assigned accounts and their current points balances.

---

# PART II: Administrator Operating Manual

> This section is exclusively for the **Platform Administrator** (`001.workme@gmail.com`).

---

### 3.1 Single-Administrator Governance Model
PointPulse enforces a strict **Single-Administrator Governance Architecture**:
- The sole authorized administrator email is hardcoded to:
  ```
  001.workme@gmail.com
  ```
- **Security Rule**: No other user can ever be promoted to administrator. Attempting to assign admin privileges to another account will be blocked by system constraints.
- All high-level governance operations—user approvals, portfolio assignments, editing window durations, reward catalogue modifications, and audit inspections—can only be executed from this account.

---

### 3.2 Administrator Sign In
1. Open `https://pointpulse-8bbn.onrender.com`.
2. Enter `001.workme@gmail.com` under **Google / Gmail Address**.
3. Enter your administrator password and click **Sign In to PointPulse** (or use **Continue with Google**).
4. Upon authentication, you will be directed to the **Enterprise Administrator Console**.

---

### 3.3 User Management & Approvals Workflow
Navigate to **`User Management`** in the left sidebar to manage all operator accounts.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        User Management Portal                          │
├────────────────────────────────────────────────────────────────────────┤
│ Pending Applications (1)                                               │
│ • laptopmew1@gmail.com   [Approve ✅]  [Reject ❌]                     │
├────────────────────────────────────────────────────────────────────────┤
│ Active Operators                                                       │
│ • laptopmew1@gmail.com   Status: ACTIVE   [Edit Permissions] [Suspend] │
└────────────────────────────────────────────────────────────────────────┘
```

#### Approving Pending Registrations
1. When new users register, they appear under **Pending User Approvals**.
2. Click **`Approve`** to grant them operator access.
3. When approved, the system automatically activates their profile and grants an initial Free Editing Period.

#### Rejecting or Suspending Operators
- Click **`Reject`** on a pending registration to deny access.
- On active operators, click **`Suspend`** to immediately revoke access if necessary.

#### Configuring Granular Operator Permissions
Click **`Permissions`** on any user row to toggle:
- `Can Add Accounts`
- `Can Edit Points`
- `Can Redeem Rewards`

---

### 3.4 Account Portfolio Ownership & Reassignment

#### The `Assigned Operator` Column
In the **All Accounts** view, the table includes an **`Assigned Operator`** column:
- Shows the exact email of the operator who owns and manages each account (e.g., `laptopmew1@gmail.com`).
- Accounts with no owner are marked as `Unassigned`.

#### Filtering Accounts by Operator
Above the accounts table, use the **`Filter by Operator / Owner`** dropdown:
- Select **All Operators** to view the entire master portfolio.
- Select a specific operator (e.g., `laptopmew1@gmail.com`) to view only accounts assigned to them.
- Select **Unassigned** to view accounts that need to be delegated.

#### Reassigning an Individual Account
1. Find the account in **All Accounts** and click **`Edit`**.
2. Locate the **`Assign Operator`** dropdown field.
3. Select the new operator email (e.g., `laptopmew1@gmail.com`).
4. Click **Save Changes**. The account and its points history are transferred immediately.

#### Bulk Migration: "Assign All to User"
To migrate all existing accounts in the database to a specific operator in a single click:
1. Navigate to **All Accounts**.
2. Click the purple **`Assign All to User`** button in the top toolbar.
3. In the confirmation dialog, select the target operator:
   ```
   laptopmew1@gmail.com
   ```
4. Click **`Confirm Transfer`**.
5. The system will reassign 100% of accounts to `laptopmew1@gmail.com` and log the event in the audit trail.

---

### 3.5 Configuring Free Editing Periods
PointPulse allows the Administrator to manage the editing window rules for all operators:

1. Click the **`Free Editing Periods`** button on the **All Accounts** toolbar.
2. In the configuration modal:
   - **Default Window Duration**: Set the window length (e.g., `24 Hours`, `48 Hours`, or `7 Days`).
   - **Auto-Start on Approval**: Toggle whether newly approved users automatically receive a Free Editing Window upon registration.
3. **Grant Custom Window to Specific User**:
   - Select a user from the dropdown.
   - Choose the window length (e.g., `2 Hours`, `12 Hours`).
   - Click **`Grant Window`**. The user's countdown timer begins immediately.

---

### 3.6 Old / New Classification Kanban Board
Navigate to **`Old / New Board`** in the sidebar:
- A visual Kanban board with two columns: **`OLD ACCOUNTS`** and **`NEW ACCOUNTS`**.
- Drag and drop account cards between columns to change their tenure classification.
- Click **`Batch Move`** to shift multiple accounts at once.

---

### 3.7 Points & Access Permissions Governance
Navigate to **`Points & Access`**:
- View real-time status of all operators who have active points-editing windows.
- Click **`Revoke Window`** at any time to immediately lock an operator's editing access.

---

### 3.8 Master Reward Catalogue Management

#### Adding & Editing Rewards
1. Navigate to **`Reward Catalogue`**.
2. Click **`+ Add New Reward`**.
3. Enter:
   - **Reward Title** (e.g., `$50 Amazon Gift Card`)
   - **Description & Terms**
   - **Points Required** (e.g., `10,000`)
   - **Available Stock / Quantity**
   - **Image or Icon**
4. Click **Publish Reward**.

#### Approving or Rejecting Redemption Requests
1. Navigate to **`Account Matching`**.
2. Review pending redemption claims submitted by operators.
3. Click **`Approve & Fulfill`** or **`Reject`** with feedback.

---

### 3.9 Notification Center & Request Approvals
Navigate to **`Notification Center`**:
- Displays real-time alerts for incoming:
  - Account Correction Requests
  - Points Window Requests
  - Reward Redemptions
- Click **`Approve`** to grant requests in a single click, or **`Reject`** with notes.

---

### 3.10 Monthly Reviews Compliance Oversight
Navigate to **`Monthly Reviews`**:
- Monitor which operators have submitted their monthly performance reviews.
- Review submitted operational feedback, banned account tallies, and operator reports.

---

### 3.11 Download Center & Executive PDF Generation
Navigate to **`Download Center`**:
- **Generate Executive PDF Report**: Creates a comprehensive, branded executive report including KPI summaries, points distribution graphs, operator performance rankings, and account inventories.
- **Export Full Database (CSV)**: Generates a complete CSV dump of all managed accounts and metadata.

---

### 3.12 Immutable Audit Logs
Navigate to **`Audit Logs`**:
- Tamper-evident, chronological log of every action taken across PointPulse:
  - User registrations and approvals
  - Login attempts (successful and failed)
  - Account additions, edits, and reassignments
  - Points updates and redemptions
- Filter logs by **Action Type**, **Actor Email**, or **Date Range**.

---

### 3.13 Google Cloud OAuth 2.0 Configuration
To ensure Google authentication functions properly:

1. Open the [Google Cloud Console Credentials Page](https://console.cloud.google.com/apis/credentials).
2. Select your Web Application OAuth Client ID:
   ```
   162534616388-ko0lpc0r6cpor5vb8tv23aodamelv9mv.apps.googleusercontent.com
   ```
3. In **Authorised JavaScript origins**, add:
   ```
   https://pointpulse-8bbn.onrender.com
   ```
4. In **Authorised redirect URIs**, add:
   ```
   https://pointpulse-8bbn.onrender.com/api/auth/google/callback
   ```
5. Click **Save** (changes take 5 minutes to propagate).

---

# PART III: Troubleshooting & FAQs

### Q1: When I click "Sign In", nothing happens or the page reloads.
- **Cause**: Browser cache may be holding an older version of the JavaScript file.
- **Solution**: Perform a hard refresh by pressing `Ctrl + F5` (Windows) or `Cmd + Shift + R` (Mac). Direct sign-in uses asynchronous API validation.

### Q2: I see "Application Submitted: Pending Review". How do I log in?
- **Cause**: PointPulse protects enterprise data by requiring Administrator approval for all new registrations.
- **Solution**: The Administrator (`001.workme@gmail.com`) must navigate to **User Management** and click **Approve** on your registration. Once approved, you can immediately log in with your email and password.

### Q3: Why is "+ Add Account" or "Edit" disabled?
- **Cause**: Your **Free Editing Period** has expired and your dashboard has entered Read-Only Mode.
- **Solution**: Go to the **Request Center** in the sidebar, click **New Request**, and submit an **Account Correction** or **Points Window** request. The Administrator can grant an immediate editing window.

### Q4: How do I assign all existing accounts to `laptopmew1@gmail.com`?
- **Solution**: Log in as `001.workme@gmail.com`, open **All Accounts**, and click **`Assign All to User`**. Select `laptopmew1@gmail.com` and confirm. All accounts will instantly transfer.

---

*PointPulse Enterprise Platform • Developed for Secure Performance & Rewards Management*
