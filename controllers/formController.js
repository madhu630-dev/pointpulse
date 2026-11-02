const { run, get, all } = require('../db/database');

let io;
const setIo = (socketIoInstance) => {
    io = socketIoInstance;
};

// Get current active form schedule & questions
const getActiveForm = async (req, res) => {
    try {
        const schedule = await get(`SELECT * FROM form_schedules WHERE is_enabled = 1 ORDER BY id DESC LIMIT 1`);
        if (!schedule) {
            return res.json({ active: false });
        }

        const questions = JSON.parse(schedule.questions || '[]');
        res.json({
            active: true,
            id: schedule.id,
            title: schedule.title,
            type: schedule.type,
            deadlineDay: schedule.deadline_day,
            questions
        });
    } catch (error) {
        console.error('Get Active Form Error:', error);
        res.status(500).json({ error: 'Error fetching active review form' });
    }
};

// User: Submit periodic review form
const submitPeriodicForm = async (req, res) => {
    const user = req.user;
    const { scheduleId, answers } = req.body;

    if (!answers || typeof answers !== 'object') {
        return res.status(400).json({ error: 'Form answers are required' });
    }

    try {
        const now = new Date().toISOString();
        const insertRes = await run(
            `INSERT INTO form_submissions (user_id, form_type, schedule_id, answers, submitted_at, status)
             VALUES (?, 'periodic_review', ?, ?, ?, 'submitted')`,
            [user.id, scheduleId || null, JSON.stringify(answers), now]
        );

        // Notify Admin
        await run(
            `INSERT INTO notifications (recipient_role, category, title, message, reference_id)
             VALUES ('admin', 'form_submission', 'Monthly Review Form Submitted', ?, ?)`,
            [
                `User ${user.name} (${user.email}) submitted their monthly review form.`,
                String(insertRes.lastID)
            ]
        );

        // Audit Log
        await run(
            `INSERT INTO audit_logs (actor_id, actor_email, actor_role, target_user_id, action, record_id, result)
             VALUES (?, ?, 'user', ?, 'Submitted Periodic Review Form', ?, 'success')`,
            [user.id, user.email, user.id, String(insertRes.lastID)]
        );

        if (io) {
            io.emit('new_form_submission', {
                submissionId: insertRes.lastID,
                user: { name: user.name, email: user.email }
            });
        }

        res.json({ success: true, message: 'Review form submitted successfully. Dashboard access unlocked!' });

    } catch (error) {
        console.error('Submit Periodic Form Error:', error);
        res.status(500).json({ error: 'Error saving form submission' });
    }
};

// Admin: View all submissions
const getFormSubmissions = async (req, res) => {
    try {
        const query = `
            SELECT s.*, u.name as user_name, u.email as user_email, u.picture as user_picture,
                   sch.title as schedule_title
            FROM form_submissions s
            JOIN app_users u ON s.user_id = u.id
            LEFT JOIN form_schedules sch ON s.schedule_id = sch.id
            ORDER BY s.id DESC
        `;
        const submissions = await all(query);
        const formatted = submissions.map(s => ({
            ...s,
            answers: JSON.parse(s.answers || '{}')
        }));
        res.json(formatted);
    } catch (error) {
        console.error('Get Form Submissions Error:', error);
        res.status(500).json({ error: 'Error fetching form submissions' });
    }
};

// Admin: Acknowledge or add notes to submission
const acknowledgeSubmission = async (req, res) => {
    const subId = req.params.id;
    const { status, adminNotes } = req.body; // 'acknowledged' | 'flagged'

    try {
        const now = new Date().toISOString();
        await run(
            `UPDATE form_submissions 
             SET status = ?, admin_notes = ?, reviewed_by = ?, reviewed_at = ?
             WHERE id = ?`,
            [status || 'acknowledged', adminNotes || '', req.user.id, now, subId]
        );

        await run(
            `INSERT INTO audit_logs (actor_id, actor_email, actor_role, action, new_value, record_id, result)
             VALUES (?, ?, 'admin', 'Acknowledged Form Submission', ?, ?, 'success')`,
            [req.user.id, req.user.email, JSON.stringify({ status, adminNotes }), String(subId)]
        );

        res.json({ success: true, message: 'Submission updated' });
    } catch (error) {
        console.error('Acknowledge Submission Error:', error);
        res.status(500).json({ error: 'Error acknowledging submission' });
    }
};

// Admin: Update Schedule or Questions
const updateSchedule = async (req, res) => {
    const { id, title, type, isEnabled, deadlineDay, questions } = req.body;
    try {
        if (!title || !questions) return res.status(400).json({ error: 'Title and questions required' });

        const qJson = JSON.stringify(questions);
        const enabled = isEnabled ? 1 : 0;
        const now = new Date().toISOString();

        if (id) {
            await run(
                `UPDATE form_schedules 
                 SET title = ?, type = ?, is_enabled = ?, deadline_day = ?, questions = ?, updated_at = ?
                 WHERE id = ?`,
                [title, type || 'beginning_of_month', enabled, deadlineDay || 5, qJson, now, id]
            );
        } else {
            await run(
                `INSERT INTO form_schedules (title, type, is_enabled, deadline_day, questions)
                 VALUES (?, ?, ?, ?, ?)`,
                [title, type || 'beginning_of_month', enabled, deadlineDay || 5, qJson]
            );
        }

        res.json({ success: true, message: 'Schedule updated' });
    } catch (error) {
        console.error('Update Schedule Error:', error);
        res.status(500).json({ error: 'Error updating schedule' });
    }
};

module.exports = {
    setIo,
    getActiveForm,
    submitPeriodicForm,
    getFormSubmissions,
    acknowledgeSubmission,
    updateSchedule
};

