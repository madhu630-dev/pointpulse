-- ==============================================================================
-- POINTPULSE – COMPLETE RELATIONAL SCHEMA MIGRATION
-- Compatible with PostgreSQL & Supabase SQL Editor
-- ==============================================================================

-- 1. Platform Users (Admin & Authenticated Google Users)
CREATE TABLE IF NOT EXISTS public.app_users (
    id SERIAL PRIMARY KEY,
    google_id TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    picture TEXT,
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'suspended')),
    display_name TEXT,
    phone TEXT,
    registration_purpose TEXT,
    account_management_description TEXT,
    terms_accepted BOOLEAN DEFAULT FALSE,
    policy_version TEXT DEFAULT '1.0',
    terms_accepted_at TIMESTAMPTZ,
    approved_at TIMESTAMPTZ,
    approved_by INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ensure Single Admin Constraint: only 001.workme@gmail.com can be admin
CREATE UNIQUE INDEX IF NOT EXISTS idx_single_admin ON public.app_users (role) WHERE role = 'admin';

-- 2. Rewards Catalog
CREATE TABLE IF NOT EXISTS public.rewards_catalog (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    points_required INTEGER NOT NULL,
    user_display TEXT NOT NULL,
    is_published BOOLEAN DEFAULT TRUE,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed Initial 11 Rewards if empty
INSERT INTO public.rewards_catalog (name, points_required, user_display, is_published, sort_order)
SELECT name, points_required, user_display, is_published, sort_order FROM (
    VALUES 
    ('Amazon $5', 6500, 'AZ ($5) – 6500 pts', true, 1),
    ('Amazon $10', 13000, 'AZ ($10) – 13000 pts', true, 2),
    ('Overwatch 500 Coins', 5000, 'OW (500 C) – 5000 pts', true, 3),
    ('Overwatch 1000 Coins', 10000, 'OW (1000 C) – 10000 pts', true, 4),
    ('League of Legends 575 RP', 6500, 'LOL (575 RP) – 6500 pts', true, 5),
    ('Minecraft 330 Minecoins', 2000, 'MC (330 MC) – 2000 pts', true, 6),
    ('Roblox 840 Robux', 13000, '840 RBX – 13000 pts', true, 7),
    ('Roblox 1050 Robux', 16750, '1050 RBX – 16750 pts', true, 8),
    ('Sea of Thieves 150 Coins', 1700, 'SOT (150 C) – 1700 pts', true, 9),
    ('Sea of Thieves 550 Coins', 5100, 'SOT (550 C) – 5100 pts', true, 10),
    ('Sea of Thieves 1000 Coins', 8500, 'SOT (1000 C) – 8500 pts', true, 11)
) AS v(name, points_required, user_display, is_published, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM public.rewards_catalog);

-- 3. User Reward Visibility Configuration
CREATE TABLE IF NOT EXISTS public.user_reward_visibility (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
    mode TEXT NOT NULL DEFAULT 'all' CHECK (mode IN ('all', 'selected')),
    selected_reward_ids JSONB DEFAULT '[]'::jsonb,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_user_reward_visibility UNIQUE (user_id)
);

-- 4. User Granular Permissions
CREATE TABLE IF NOT EXISTS public.user_permissions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
    permission_key TEXT NOT NULL,
    granted_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    granted_by INTEGER,
    CONSTRAINT uq_user_permission UNIQUE (user_id, permission_key)
);

-- 5. Temporary Access Windows
CREATE TABLE IF NOT EXISTS public.temporary_access_windows (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    permitted_actions JSONB DEFAULT '["update_points"]'::jsonb,
    is_active BOOLEAN DEFAULT TRUE,
    created_by INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. User Requests (Request Center)
CREATE TABLE IF NOT EXISTS public.user_requests (
    id SERIAL PRIMARY KEY,
    request_id TEXT UNIQUE NOT NULL,
    user_id INTEGER NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
    category TEXT NOT NULL CHECK (category IN (
        'points_update', 
        'account_correction', 
        'classification_change', 
        'download_permission', 
        'redemption', 
        'contact_admin'
    )),
    subject TEXT NOT NULL,
    message TEXT NOT NULL,
    account_id INTEGER,
    details JSONB DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Under Review', 'Approved', 'Rejected', 'Completed')),
    admin_response TEXT,
    reviewed_by INTEGER,
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. Notifications (Admin & User Notification Center)
CREATE TABLE IF NOT EXISTS public.notifications (
    id SERIAL PRIMARY KEY,
    recipient_role TEXT NOT NULL DEFAULT 'admin' CHECK (recipient_role IN ('admin', 'user')),
    recipient_id INTEGER REFERENCES public.app_users(id) ON DELETE CASCADE,
    category TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    data JSONB DEFAULT '{}'::jsonb,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. Periodic Form Schedules & Reviews
CREATE TABLE IF NOT EXISTS public.form_schedules (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('beginning_of_month', 'end_of_month')),
    is_enabled BOOLEAN DEFAULT TRUE,
    deadline_day INTEGER NOT NULL DEFAULT 5,
    questions JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9. Form Submissions
CREATE TABLE IF NOT EXISTS public.form_submissions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
    form_type TEXT NOT NULL CHECK (form_type IN ('registration', 'periodic_review')),
    schedule_id INTEGER REFERENCES public.form_schedules(id) ON DELETE SET NULL,
    answers JSONB NOT NULL,
    submitted_at TIMESTAMPTZ DEFAULT NOW(),
    status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'acknowledged', 'flagged')),
    reviewed_by INTEGER,
    reviewed_at TIMESTAMPTZ,
    admin_notes TEXT
);

-- 10. Download Requests & Secure Tokens
CREATE TABLE IF NOT EXISTS public.download_requests (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
    report_type TEXT NOT NULL,
    filters JSONB DEFAULT '{}'::jsonb,
    token TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
    expires_at TIMESTAMPTZ,
    approved_by INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 11. Comprehensive Audit Logs (Append-Only)
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id SERIAL PRIMARY KEY,
    actor_id INTEGER,
    actor_email TEXT,
    actor_role TEXT,
    target_user_id INTEGER,
    action TEXT NOT NULL,
    previous_value JSONB,
    new_value JSONB,
    result TEXT NOT NULL DEFAULT 'success',
    record_id TEXT,
    ip_address TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 12. Points Audit Logs (Granular point modifications)
CREATE TABLE IF NOT EXISTS public.points_audit_log (
    id SERIAL PRIMARY KEY,
    account_id INTEGER NOT NULL,
    user_id INTEGER,
    previous_points INTEGER,
    new_points INTEGER NOT NULL,
    difference INTEGER NOT NULL,
    updated_by INTEGER,
    updated_by_name TEXT,
    source TEXT DEFAULT 'web',
    auth_ref TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 13. Account Classification History
CREATE TABLE IF NOT EXISTS public.account_classification_history (
    id SERIAL PRIMARY KEY,
    account_id INTEGER NOT NULL,
    previous_classification TEXT,
    new_classification TEXT NOT NULL,
    changed_by INTEGER,
    reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 14. Policy Acknowledgements
CREATE TABLE IF NOT EXISTS public.policy_acknowledgements (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    user_type TEXT NOT NULL DEFAULT 'user' CHECK (user_type IN ('user', 'admin')),
    policy_version TEXT NOT NULL DEFAULT '1.0',
    accepted_at TIMESTAMPTZ DEFAULT NOW(),
    ip_address TEXT
);

-- 15. Ensure existing Users table has classification and user_id columns
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='Users' AND column_name='classification') THEN
        ALTER TABLE public."Users" ADD COLUMN classification TEXT DEFAULT 'new';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='Users' AND column_name='user_id') THEN
        ALTER TABLE public."Users" ADD COLUMN user_id INTEGER;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='Users' AND column_name='created_at') THEN
        ALTER TABLE public."Users" ADD COLUMN created_at TIMESTAMPTZ DEFAULT NOW();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='Users' AND column_name='updated_at') THEN
        ALTER TABLE public."Users" ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
    END IF;
END $$;

