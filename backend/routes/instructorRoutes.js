// backend/routes/instructorRoutes.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.MAIL_USER,
        pass: process.env.MAIL_PASS
    }
});
// ==========================================
// 1. GET /api/instructors
// Lấy danh sách giảng viên (có lọc)
// ==========================================
router.get('/', async(req, res) => {
    try {
        const { status, keyword } = req.query;
        let sql = `SELECT * FROM instructors WHERE 1=1`;
        const params = [];

        if (status) {
            sql += ` AND status = ?`;
            params.push(status);
        }

        if (keyword) {
            const kw = `%${keyword}%`;
            sql += ` AND (full_name LIKE ? OR phone LIKE ? OR email LIKE ?)`;
            params.push(kw, kw, kw);
        }

        sql += ` ORDER BY created_at DESC`;

        const [rows] = await db.query(sql, params);
        res.json({ success: true, instructors: rows });
    } catch (err) {
        console.error("Lỗi lấy DS giảng viên:", err);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

// ==========================================
// 2. POST /api/instructors
// Thêm mới giảng viên + Tự tạo tài khoản
// ==========================================


// API Thêm giảng viên mới + Tự động tạo tài khoản User
// 2. Cập nhật router.post
// ... (giữ nguyên phần đầu file)

// backend/routes/instructorRoutes.js

router.post('/', async(req, res) => {
    // 1. Lấy dữ liệu từ frontend
    const {
        full_name,
        type,
        phone,
        email,
        specialization,
        hourly_rate,
        bank_account,
        bank_name,
        bio
    } = req.body;

    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
        // 2. Chèn vào bảng INSTRUCTORS
        const [insResult] = await connection.query(
            `INSERT INTO instructors 
            (full_name, type, phone, email, specialization, hourly_rate, bank_account, bank_name, bio, status) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')`, [full_name, type, phone, email, specialization, hourly_rate, bank_account, bank_name, bio]
        );

        const newInstructorId = insResult.insertId;

        // 3. Xử lý tạo tài khoản User (Đã sửa: Quay lại dùng gv + ID)
        // -----------------------------------------------------------
        const username = `gv${newInstructorId}`; // Ví dụ: gv4, gv5...
        // -----------------------------------------------------------

        const defaultPassword = '123456';
        const hashedPassword = await bcrypt.hash(defaultPassword, 10);

        // Chèn vào bảng USERS
        await connection.query(
            `INSERT INTO users (username, password, role, instructor_id, active) 
            VALUES (?, ?, 'INSTRUCTOR', ?, 1)`, [username, hashedPassword, newInstructorId]
        );

        await connection.commit();

        // 4. Gửi Email thông báo
        try {
            await transporter.sendMail({
                from: `"Trung tâm Tiếng Anh" <${process.env.MAIL_USER}>`,
                to: email,
                subject: '🔑 Tài khoản Giảng viên mới',
                // Đã sửa nội dung hiển thị đúng username là gv...
                html: `<p>Chào ${full_name},<br>
                       Tài khoản đăng nhập của bạn đã được tạo:<br>
                       - Tên đăng nhập: <b>${username}</b><br>
                       - Mật khẩu: <b>123456</b></p>`
            });
        } catch (mailErr) {
            console.error("Lỗi gửi mail:", mailErr.message);
        }

        res.status(201).json({ success: true, message: "Thành công!", username });

    } catch (error) {
        await connection.rollback();
        console.error("Lỗi tạo giảng viên:", error);
        res.status(500).json({ success: false, message: "Lỗi server" });
    } finally {
        connection.release();
    }
});
// ... (các phần còn lại giữ nguyên)
// ==========================================
// 3. PUT /api/instructors/:id
// Cập nhật thông tin
// ==========================================
router.put('/:id', async(req, res) => {
    const { id } = req.params;
    const { full_name, type, phone, email, specialization, hourly_rate, bank_account, bank_name, status, bio } = req.body;

    try {
        await db.query(
            `UPDATE instructors 
             SET full_name=?, type=?, phone=?, email=?, specialization=?, hourly_rate=?, 
                 bank_account=?, bank_name=?, status=?, bio=?, updated_at=NOW()
             WHERE id=?`, [full_name, type, phone, email, specialization, hourly_rate, bank_account, bank_name, status, bio, id]
        );
        res.json({ success: true, message: 'Cập nhật thông tin thành công' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

// ==========================================
// 4. GET /api/instructors/:id/classes
// Xem lịch sử giảng dạy (để tính lương hoặc xem lịch)
// ==========================================
router.get('/:id/classes', async(req, res) => {
    const { id } = req.params;
    try {
        // Lấy danh sách lớp mà giảng viên này được phân công (bảng class_teachers)
        const [rows] = await db.query(`
            SELECT c.id, c.name, c.level, c.start_date, c.end_date, ct.role, ct.assigned_at
            FROM class_teachers ct
            JOIN classes c ON ct.class_id = c.id
            WHERE ct.teacher_id = ?
            ORDER BY c.start_date DESC
        `, [id]);

        res.json({ success: true, classes: rows });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});
// ==========================================
// 5. GET /api/instructors/:id/schedule
// Lấy lịch giảng dạy sắp tới của giảng viên
// ==========================================
router.get('/:id/schedule', async(req, res) => {
    const instructorId = req.params.id;

    try {
        const [rows] = await db.query(`
            SELECT
                cs.id AS schedule_id,
                 c.id AS class_id, 
                c.name AS class_name,
                cs.scheduled_at,
                JSON_UNQUOTE(JSON_EXTRACT(cs.meta, '$.room')) AS room,
                JSON_UNQUOTE(JSON_EXTRACT(cs.meta, '$.start')) AS start_time,
                JSON_UNQUOTE(JSON_EXTRACT(cs.meta, '$.end')) AS end_time
            FROM class_teachers ct
            JOIN classes c ON ct.class_id = c.id
            JOIN class_schedules cs ON cs.class_id = c.id
            WHERE ct.teacher_id = ?
              AND cs.scheduled_at >= NOW()
            ORDER BY cs.scheduled_at ASC
        `, [instructorId]);

        res.json({ success: true, schedules: rows });

    } catch (err) {
        console.error('Lỗi lấy lịch dạy:', err);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

module.exports = router;