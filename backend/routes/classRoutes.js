// backend/routes/classRoutes.js
const express = require('express');
const router = express.Router();
const db = require('../db');


router.post('/', async(req, res) => {
    const { name, teacher_id, dates, startTime, endTime, room, capacity } = req.body;

    // Validate 5 ngày
    if (!dates || dates.length !== 5) {
        return res.status(400).json({ success: false, message: 'Vui lòng chọn đúng 5 ngày học.' });
    }

    let conn;
    try {
        conn = await db.getConnection();
        await conn.beginTransaction();

        // 1. Xác định ngày bắt đầu/kết thúc
        dates.sort(); // Sắp xếp ngày tăng dần
        const startDate = dates[0];
        const endDate = dates[dates.length - 1];

        // 2. Insert Lớp
        const [clsResult] = await conn.query(
            `INSERT INTO classes (name, capacity, start_date, end_date, created_at) 
             VALUES (?, ?, ?, ?, NOW())`, [name, capacity || 20, startDate, endDate]
        );
        const classId = clsResult.insertId;

        // 3. Gán Giảng viên (Nếu có chọn)
        if (teacher_id) {
            await conn.query(
                `INSERT INTO class_teachers (class_id, teacher_id, role, assigned_at) 
                 VALUES (?, ?, 'MAIN', NOW())`, [classId, teacher_id]
            );
            // Đảm bảo giảng viên active
            await conn.query(`UPDATE instructors SET status = 'ACTIVE' WHERE id = ?`, [teacher_id]);
        }

        // 4. Tạo 5 Buổi học (Lịch)
        const meta = JSON.stringify({ start: startTime, end: endTime, room: room });

        for (const date of dates) {
            const scheduledAt = `${date} ${startTime}:00`;
            await conn.query(
                `INSERT INTO class_schedules (class_id, scheduled_at, meta, created_at) 
                 VALUES (?, ?, ?, NOW())`, [classId, scheduledAt, meta]
            );
        }

        await conn.commit();
        res.json({ success: true, message: 'Đã tạo lớp và lịch học thành công!' });

    } catch (err) {
        if (conn) await conn.rollback();
        console.error(err);
        res.status(500).json({ success: false, message: 'Lỗi server khi tạo lớp.' });
    } finally {
        if (conn) conn.release();
    }
});


router.post('/:id/assign', async(req, res) => {
    const classId = req.params.id;
    // Bắt buộc phải gửi lên cả studentId VÀ courseId để check bill
    const { studentId, courseId } = req.body;

    if (!studentId || !courseId) {
        return res.status(400).json({ success: false, message: 'Thiếu ID học viên hoặc ID khóa học.' });
    }

    let conn;
    try {
        conn = await db.getConnection();

        // 1. Kiểm tra Học viên có tồn tại không
        const [st] = await conn.query(`SELECT full_name FROM students WHERE id = ?`, [studentId]);
        if (st.length === 0) return res.status(404).json({ success: false, message: 'Không tìm thấy học viên.' });

        // 2. [QUAN TRỌNG] Kiểm tra đã ĐÓNG TIỀN (PAID) cho khóa học này chưa?
        // Logic: Phải có bản ghi trong bảng invoices với status = 'PAID'
        const [invoice] = await conn.query(
            `SELECT id FROM invoices 
             WHERE student_id = ? AND course_id = ? AND status = 'PAID' 
             LIMIT 1`, [studentId, courseId]
        );

        if (invoice.length === 0) {
            return res.status(400).json({
                success: false,
                message: `Học viên chưa thanh toán (PAID) cho khóa học này (Course ID: ${courseId}). Vui lòng liên hệ kế toán.`
            });
        }

        // 3. Kiểm tra xem đã vào lớp này chưa (tránh trùng)
        const [exist] = await conn.query(
            `SELECT 1 FROM class_students WHERE class_id = ? AND student_id = ?`, [classId, studentId]
        );
        if (exist.length > 0) {
            return res.status(400).json({ success: false, message: 'Học viên đã có trong lớp này rồi.' });
        }

        // 4. Gán vào lớp
        await conn.query(
            `INSERT INTO class_students (class_id, student_id, status, joined_at) VALUES (?, ?, 'ACTIVE', NOW())`, [classId, studentId]
        );

        // 5. Update trạng thái học viên thành ACTIVE
        await conn.query(`UPDATE students SET status = 'ACTIVE' WHERE id = ?`, [studentId]);

        res.json({ success: true, message: `✅ Đã thêm học viên ${st[0].full_name} vào lớp.` });

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Lỗi server khi gán học viên.' });
    } finally {
        if (conn) conn.release();
    }
});


router.delete('/:id', async(req, res) => {
    const classId = req.params.id;
    let conn;
    try {
        conn = await db.getConnection();
        await conn.beginTransaction();

        // 1. Lấy danh sách học viên trong lớp để reset trạng thái sau này
        const [students] = await conn.query(
            `SELECT student_id FROM class_students WHERE class_id = ?`, [classId]
        );

        // 2. Xóa dữ liệu liên quan
        await conn.query(`DELETE FROM class_schedules WHERE class_id = ?`, [classId]);
        await conn.query(`DELETE FROM class_teachers WHERE class_id = ?`, [classId]);
        await conn.query(`DELETE FROM class_students WHERE class_id = ?`, [classId]);
        await conn.query(`DELETE FROM classes WHERE id = ?`, [classId]);

        // 3. LOGIC HOÀN TÁC: Đưa học viên về trạng thái 'NEW' (chưa gán)
        // Lưu ý: Chỉ reset nếu họ không còn học lớp nào khác đang ACTIVE
        for (const s of students) {
            const [otherClasses] = await conn.query(
                `SELECT 1 FROM class_students WHERE student_id = ? AND status = 'ACTIVE'`, [s.student_id]
            );
            if (otherClasses.length === 0) {
                // Nếu không còn lớp active nào -> Về trạng thái PAID (đã đóng tiền nhưng chưa học) hoặc NEW
                // Ở đây ta set về 'NEW' hoặc giữ nguyên logic cũ của bạn
                await conn.query(`UPDATE students SET status = 'NEW' WHERE id = ?`, [s.student_id]);
            }
        }

        await conn.commit();
        res.json({ success: true, message: 'Đã xóa lớp và hoàn tác trạng thái học viên.' });

    } catch (err) {
        if (conn) await conn.rollback();
        console.error(err);
        res.status(500).json({ success: false, message: 'Lỗi khi xóa lớp.' });
    } finally {
        if (conn) conn.release();
    }
});


router.get('/', async(req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT c.*, 
            (SELECT COUNT(*) FROM class_students cs WHERE cs.class_id = c.id) as student_count,
            i.full_name as teacher_name
            FROM classes c
            LEFT JOIN class_teachers ct ON c.id = ct.class_id AND ct.role = 'MAIN'
            LEFT JOIN instructors i ON ct.teacher_id = i.id
            ORDER BY c.id DESC
        `);
        res.json({ success: true, classes: rows });
    } catch (err) {
        res.status(500).json({ success: false, message: 'DB error' });
    }
});

router.get('/:id/students', async(req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT s.id, s.full_name, s.email, s.phone, cs.status
            FROM class_students cs
            JOIN students s ON s.id = cs.student_id
            WHERE cs.class_id = ?
        `, [req.params.id]);
        res.json({ success: true, students: rows });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Lỗi lấy danh sách HV' });
    }
});

module.exports = router;
