const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL || 'https://ebmfbnvmipevdrhylisw.supabase.co';
const supabaseKey = process.env.SUPABASE_KEY || 'sb_publishable_-quvVia82ltJdRO-9pH2Kw_vfLXhC99';

const realSupabase = createClient(supabaseUrl, supabaseKey);

// In-Memory Test Store for Hermetic Automated Testing in Sandboxed Environments
const memTables = {
    Users: [
        { id: 1, profile_no: 1, email: 'alpha.acc@gmail.com', server: 'US-GA#525', status: 'active', notes: '', is_pinned: false },
        { id: 2, profile_no: 2, email: 'bravo.acc@gmail.com', server: 'US-TX#450', status: 'active', notes: '', is_pinned: false },
        { id: 3, profile_no: 3, email: 'charlie.acc@gmail.com', server: 'US-CA#655', status: 'banned', notes: '', is_pinned: false },
    ],
    Points: [
        { id: 1, user_id: 1, points: 738, date: '2026-11-01', updated_at: new Date().toISOString() },
        { id: 2, user_id: 2, points: 3164, date: '2026-11-01', updated_at: new Date().toISOString() }
    ],
    Redemptions: []
};

class MemoryQueryBuilder {
    constructor(tableName) {
        if (!memTables[tableName]) memTables[tableName] = [];
        this.rows = memTables[tableName];
        this.filters = [];
        this.orders = [];
        this._single = false;
        this._limit = null;
        this._countOpts = null;
    }
    select(cols, opts) {
        this._selectCols = cols;
        this._countOpts = opts;
        return this;
    }
    eq(col, val) {
        this.filters.push(r => r[col] == val);
        return this;
    }
    like(col, pattern) {
        const regexStr = pattern.replace(/%/g, '.*');
        const regex = new RegExp(`^${regexStr}$`, 'i');
        this.filters.push(r => r[col] && regex.test(String(r[col])));
        return this;
    }
    in(col, vals) {
        this.filters.push(r => Array.isArray(vals) && vals.includes(r[col]));
        return this;
    }
    order(col, opts = {}) {
        this.orders.push({ col, asc: opts.ascending !== false });
        return this;
    }
    limit(n) {
        this._limit = n;
        return this;
    }
    range(from, to) {
        this._range = { from, to };
        return this;
    }
    single() {
        this._single = true;
        return this;
    }
    insert(records) {
        const arr = Array.isArray(records) ? records : [records];
        this._inserted = [];
        for (const item of arr) {
            const row = Object.assign({ id: this.rows.length + 1 }, item);
            this.rows.push(row);
            this._inserted.push(row);
        }
        return this;
    }
    upsert(records) {
        return this.insert(records);
    }
    update(updates) {
        this._updates = updates;
        return this;
    }
    async delete() {
        const toDelete = new Set(this.rows.filter(r => this.filters.every(f => f(r))));
        for (let i = this.rows.length - 1; i >= 0; i--) {
            if (toDelete.has(this.rows[i])) this.rows.splice(i, 1);
        }
        return { data: null, error: null };
    }
    then(resolve, reject) {
        if (this._updates) {
            const matched = this.rows.filter(r => this.filters.every(f => f(r)));
            matched.forEach(r => Object.assign(r, this._updates));
            return resolve({ data: matched, error: null });
        }
        let result = this._inserted ? this._inserted : this.rows.filter(r => this.filters.every(f => f(r)));
        for (const o of this.orders) {
            result.sort((a, b) => {
                if (a[o.col] < b[o.col]) return o.asc ? -1 : 1;
                if (a[o.col] > b[o.col]) return o.asc ? 1 : -1;
                return 0;
            });
        }
        if (this._range) {
            result = result.slice(this._range.from, this._range.to + 1);
        } else if (this._limit !== null) {
            result = result.slice(0, this._limit);
        }
        const data = this._single ? (result[0] || null) : result;
        resolve({ data, error: null, count: this._countOpts ? result.length : undefined });
    }
}

// In test mode, always use in-memory hermetic client
const supabase = (process.env.NODE_ENV === 'test') ? {
    from: (table) => new MemoryQueryBuilder(table)
} : realSupabase;

module.exports = supabase;
