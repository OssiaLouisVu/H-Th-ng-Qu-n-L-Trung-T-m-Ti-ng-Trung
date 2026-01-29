const express = require('express');
const router = express.Router();
const db = require('../db');
const nodemailer = require('nodemailer');
require('dotenv').config();


const mailTransporter = nodemailer.createTransport({
    service: process.env.MAIL_SERVICE || 'gmail',
    auth: { user: process.env.MAIL_USER, pass: process.env.MAIL_PASS },
});

function vnStatus(status) {
    switch (String(status || '').toLowerCase()) {
        case 'present':
            return 'Đi làm';
        case 'leave':
            return 'Nghỉ phép';
        case 'sick':
            return 'Nghỉ ốm';
        case 'absent':
            return 'Vắng';
        default:
            return status || '-';
    }
}

async function fetchFilteredEmployees({ role = 'ALL', search = '', active = 'true' }) {
    const where = [];
    const params = [];
    if (active === 'true') where.push('e.active = TRUE');
    else if (active === 'false') where.push('e.active = FALSE');
    if (role && role !== 'ALL') { where.push('(COALESCE(u.role, e.role) = ?)');
        params.push(role); }
    if (search && search.trim()) {
        const q = `%${search.trim()}%`;
        where.push('(e.full_name LIKE ? OR e.phone LIKE ? OR e.email LIKE ?)');
        params.push(q, q, q);
    }
    const sql = `SELECT e.id, e.full_name, e.email, e.active, COALESCE(u.role, e.role) AS role
               FROM employees e
               LEFT JOIN users u ON u.id = e.user_id` +
        (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
        ' ORDER BY e.full_name ASC';
    const [rows] = await db.execute(sql, params);
    return rows || [];
}


router.get('/', async(req, res) => {
    const { date } = req.query;
    if (!date) {
        return res.status(400).json({ success: false, message: 'Thiếu tham số date (YYYY-MM-DD)' });
    }
    try {
        const [rows] = await db.execute(
            `SELECT a.id, a.employee_id, e.full_name, a.date, a.status, a.note
       FROM attendance a
       JOIN employees e ON e.id = a.employee_id
       WHERE a.date = ?
       ORDER BY e.full_name ASC`, [date]
        );
        res.json({ success: true, records: rows });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});


router.post('/', async(req, res) => {
    const { date, items } = req.body || {};
    if (!date || !Array.isArray(items)) {
        return res.status(400).json({ success: false, message: 'Thiếu date hoặc items' });
    }
    try {
        for (const it of items) {
            if (!it.employee_id || !it.status) continue;
            // Upsert: if record exists for (employee_id, date), update; else insert
            const [exists] = await db.execute(
                `SELECT id FROM attendance WHERE employee_id = ? AND date = ?`, [it.employee_id, date]
            );
            if (exists && exists.length > 0) {
                await db.execute(
                    `UPDATE attendance SET status = ?, note = ? WHERE id = ?`, [it.status, it.note || null, exists[0].id]
                );
            } else {
                await db.execute(
                    `INSERT INTO attendance (employee_id, date, status, note) VALUES (?, ?, ?, ?)`, [it.employee_id, date, it.status, it.note || null]
                );
            }
        }
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});


router.put('/:id', async(req, res) => {
    const id = req.params.id;
    const { status, note } = req.body || {};
    if (!status) {
        return res.status(400).json({ success: false, message: 'Thiếu status' });
    }
    try {
        await db.execute(`UPDATE attendance SET status = ?, note = ? WHERE id = ?`, [status, note || null, id]);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

module.exports = router;


router.get('/monthly', async(req, res) => {
    const { month, role = 'ALL', search = '', active = 'true' } = req.query;
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
        return res.status(400).json({ success: false, message: 'Thiếu hoặc sai định dạng month (YYYY-MM)' });
    }
    const firstDay = `${month}-01`;
    try {
        const employees = await fetchFilteredEmployees({ role, search, active });
        if (employees.length === 0) return res.json({ success: true, summary: { present: 0, leave: 0, sick: 0, absent: 0 }, employees: [] });

        // Range [firstDay, lastDay]
        const [
            [{ lastDay }]
        ] = await db.query('SELECT LAST_DAY(?) AS lastDay', [firstDay]);

        const [agg] = await db.execute(
            `SELECT employee_id, status, COUNT(*) AS cnt
       FROM attendance
       WHERE date BETWEEN ? AND ?
       GROUP BY employee_id, status`, [firstDay, lastDay]
        );

        const [details] = await db.execute(
            `SELECT employee_id, date, status, note
       FROM attendance
       WHERE date BETWEEN ? AND ?`, [firstDay, lastDay]
        );

        const byEmpTotals = new Map();
        const byEmpDays = new Map();
        for (const e of employees) {
            byEmpTotals.set(e.id, { present: 0, leave: 0, sick: 0, absent: 0 });
            byEmpDays.set(e.id, {});
        }
        for (const r of agg) {
            if (!byEmpTotals.has(r.employee_id)) continue;
            const t = byEmpTotals.get(r.employee_id);
            const key = String(r.status || '').toLowerCase();
            if (t.hasOwnProperty(key)) t[key] += Number(r.cnt) || 0;
        }
        for (const d of details) {
            if (!byEmpDays.has(d.employee_id)) continue;
            const days = byEmpDays.get(d.employee_id);
            days[d.date] = { status: d.status, note: d.note };
        }

        const resultEmployees = employees.map(e => ({
            id: e.id,
            full_name: e.full_name,
            role: e.role,
            active: !!e.active,
            totals: byEmpTotals.get(e.id) || { present: 0, leave: 0, sick: 0, absent: 0 },
            days: byEmpDays.get(e.id) || {},
        }));

        const overall = { present: 0, leave: 0, sick: 0, absent: 0 };
        resultEmployees.forEach(e => {
            overall.present += e.totals.present;
            overall.leave += e.totals.leave;
            overall.sick += e.totals.sick;
            overall.absent += e.totals.absent;
        });

        res.json({ success: true, summary: overall, employees: resultEmployees, month, range: { from: firstDay, to: lastDay } });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});


router.post('/notify/daily', async(req, res) => {
    const { date, target = 'all', role = 'ALL', search = '', active = 'true' } = req.body || {};
    if (!date) return res.status(400).json({ success: false, message: 'Thiếu date (YYYY-MM-DD)' });
    if (!process.env.MAIL_USER || !process.env.MAIL_PASS) return res.status(500).json({ success: false, message: 'Chưa cấu hình MAIL_USER/MAIL_PASS' });
    try {
        const employees = await fetchFilteredEmployees({ role, search, active });
        if (employees.length === 0) return res.json({ success: true, sent: 0 });

        const [rows] = await db.execute(
            `SELECT employee_id, status, note FROM attendance WHERE date = ?`, [date]
        );
        const byEmp = new Map();
        rows.forEach(r => byEmp.set(r.employee_id, r));

        const toSend = employees
            .map(e => ({ e, rec: byEmp.get(e.id) }))
            .filter(x => x.rec && (target === 'all' || String(x.rec.status).toLowerCase() === target));

        let sent = 0;
        for (const it of toSend) {
            const r = it.rec;
            const name = it.e.full_name || 'Anh/Chị';
            const statusVN = vnStatus(r.status);
            const [y, m, d] = date.split('-');
            const subject = `[Chấm công] Ngày ${d}/${m}/${y}`;
            const text = `Xin chào ${name},\n\nTrạng thái chấm công ngày ${d}/${m}/${y}: ${statusVN}.\nGhi chú: ${r.note ? r.note : 'Không có'}.\n\nTrân trọng.`;
            if (it.e.email && String(it.e.email).includes('@')) {
                // eslint-disable-next-line no-await-in-loop
                await mailTransporter.sendMail({ from: `Trung tâm <${process.env.MAIL_USER}>`, to: it.e.email, subject, text });
                sent += 1;
            }
        }
        res.json({ success: true, sent });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});


router.post('/notify/monthly', async(req, res) => {
    const { month, role = 'ALL', search = '', active = 'true' } = req.body || {};
    if (!month || !/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ success: false, message: 'Thiếu hoặc sai month (YYYY-MM)' });
    if (!process.env.MAIL_USER || !process.env.MAIL_PASS) return res.status(500).json({ success: false, message: 'Chưa cấu hình MAIL_USER/MAIL_PASS' });
    const firstDay = `${month}-01`;
    try {
        const employees = await fetchFilteredEmployees({ role, search, active });
        if (employees.length === 0) return res.json({ success: true, sent: 0 });
        const [
            [{ lastDay }]
        ] = await db.query('SELECT LAST_DAY(?) AS lastDay', [firstDay]);
        const [agg] = await db.execute(
            `SELECT employee_id, status, COUNT(*) AS cnt
       FROM attendance
       WHERE date BETWEEN ? AND ?
       GROUP BY employee_id, status`, [firstDay, lastDay]
        );
        const map = new Map();
        employees.forEach(e => map.set(e.id, { present: 0, leave: 0, sick: 0, absent: 0, e }));
        agg.forEach(r => {
            if (!map.has(r.employee_id)) return;
            const t = map.get(r.employee_id);
            const key = String(r.status || '').toLowerCase();
            if (t.hasOwnProperty(key)) t[key] += Number(r.cnt) || 0;
        });

        let sent = 0;
        const [y, m] = month.split('-');
        for (const { e, present, leave, sick, absent }
            of map.values()) {
            if (!e.email || !String(e.email).includes('@')) continue;
            const subject = `[Chấm công] Tổng hợp tháng ${m}/${y}`;
            const text = `Xin chào ${e.full_name || 'Anh/Chị'},\n\nTổng hợp chấm công tháng ${m}/${y}:\n- Đi làm: ${present}\n- Nghỉ phép: ${leave}\n- Nghỉ ốm: ${sick}\n- Vắng: ${absent}\n\nTrân trọng.`;
            // eslint-disable-next-line no-await-in-loop
            await mailTransporter.sendMail({ from: `Trung tâm <${process.env.MAIL_USER}>`, to: e.email, subject, text });
            sent += 1;
        }
        res.json({ success: true, sent });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});
