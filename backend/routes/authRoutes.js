const express = require("express");
const db = require("../db");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const router = express.Router();

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.MAIL_USER,
        pass: process.env.MAIL_PASS
    }
});



router.post("/forgot-password", async(req, res) => {
    const { email, role } = req.body || {};

    if (!email || !email.trim() || !role) {
        return res.status(400).json({ success: false, message: "Vui lòng nhập email và vai trò" });
    }

    try {
        let users = [];
        const trimmedEmail = email.trim();

        if (role === 'STUDENT') {
            const [stdRows] = await db.execute(
                `SELECT u.id AS user_id, u.username, s.full_name AS name, s.email
                 FROM users u
                 INNER JOIN students s ON u.student_id = s.id
                 WHERE s.email = ? AND u.role = 'STUDENT'`, [trimmedEmail]
            );
            users = stdRows || [];
        } else if (role === 'INSTRUCTOR') {
            // Tìm kiếm dựa trên email trong bảng instructors trước để đảm bảo tìm thấy chủ sở hữu
            const [instRows] = await db.execute(
                `SELECT u.id AS user_id, u.username, i.full_name AS name, i.email
         FROM instructors i
         INNER JOIN users u ON u.instructor_id = i.id
         WHERE i.email = ? AND u.role = 'INSTRUCTOR'`, [email.trim()]
            );
            users = instRows || [];

        } else {
            const [empRows] = await db.execute(
                `SELECT u.id AS user_id, u.username, e.full_name AS name, e.email
                 FROM users u
                 INNER JOIN employees e ON e.user_id = u.id
                 WHERE e.email = ? AND u.role = ? AND e.active = TRUE`, [trimmedEmail, role]
            );
            users = empRows || [];
        }

        if (users.length === 0) {
            return res.json({
                success: true,
                message: "Nếu thông tin khớp, link đặt lại mật khẩu đã được gửi đến email của bạn."
            });
        }

        const user = users[0];
        const resetToken = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

        await db.execute(`DELETE FROM password_reset_tokens WHERE user_id = ?`, [user.user_id]);
        await db.execute(
            `INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES (?, ?, ?)`, [user.user_id, resetToken, expiresAt]
        );

        const resetLink = `http://localhost:5173/reset-password?token=${resetToken}`;
        await transporter.sendMail({
            from: `"Trung tâm Tiếng Anh" <${process.env.MAIL_USER}>`,
            to: user.email,
            subject: '🔐 Đặt lại mật khẩu tài khoản ' + role,
            html: `<p>Xin chào ${user.name},</p><p>Nhấn vào link để đặt mật khẩu mới: <a href="${resetLink}">${resetLink}</a></p>`
        });

        return res.json({ success: true, message: "Link đặt lại mật khẩu đã được gửi." });

    } catch (e) {
        console.error('Error:', e.message);
        res.status(500).json({ success: false, message: "Lỗi server" });
    }
});


router.post("/reset-password", async(req, res) => {
    const { token, newPassword } = req.body || {};
    try {
        const [tokenRows] = await db.execute(
            `SELECT user_id, expires_at FROM password_reset_tokens WHERE token = ?`, [token]
        );

        if (!tokenRows.length || new Date() > new Date(tokenRows[0].expires_at)) {
            return res.status(400).json({ success: false, message: "Token không hợp lệ hoặc hết hạn" });
        }

        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await db.execute(`UPDATE users SET password = ? WHERE id = ?`, [hashedPassword, tokenRows[0].user_id]);
        await db.execute(`DELETE FROM password_reset_tokens WHERE token = ?`, [token]);

        res.json({ success: true, message: "Đổi mật khẩu thành công" });
    } catch (e) {
        res.status(500).json({ success: false, message: "Lỗi server" });
    }
});

module.exports = router;
