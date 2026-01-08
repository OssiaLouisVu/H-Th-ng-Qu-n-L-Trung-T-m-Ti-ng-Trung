 // ======================================================
 // =============== BACKEND ENGLISH CENTER ===============
 // ======================================================
 const express = require("express");
 const cors = require("cors");
 const nodemailer = require("nodemailer");

 require("dotenv").config();
 const db = require("./db");
 const bcrypt = require('bcryptjs');
 const instructorRoutes = require('./routes/instructorRoutes');
 // Router quản lý học viên (STAFF)
 const studentRoutes = require("./routes/studentRoutes");
 // Router quản lý lịch (assign / finish)
 const scheduleRoutes = require("./routes/scheduleRoutes");
 // Router quản lý lớp
 const classRoutes = require("./routes/classRoutes");
 // Router quản lý session (timetable)
 const sessionRoutes = require("./routes/sessionRoutes");
 // Router quản lý nhân viên (manager)
 const employeeRoutes = require("./routes/employee");
 // Router thông báo qua email
 const notifyRoutes = require("./routes/notifyRoutes");

 // Router chấm công nhân viên
 const attendanceRoutes = require("./routes/attendanceRoutes");

 // Router quản lý học phí (ACCOUNTANT)
 // server.js
 const feeRoutes = require("./routes/feeRoutes");



 // Router quản lý khóa học (STAFF)
 const courseRoutes = require("./routes/courseRoutes");

 // Router quản lý giảng viên (STAFF)


 const app = express();
 const PORT = process.env.PORT || 8080;

 // Debug xem env đã load chưa
 console.log("MAIL_USER =", process.env.MAIL_USER);
 console.log(
     "MAIL_PASS length =",
     process.env.MAIL_PASS ? process.env.MAIL_PASS.length : "undefined"
 );
 app.use(
     cors({
         origin: "http://localhost:5173",
         methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
         allowedHeaders: ["Content-Type", "Authorization"],
     })
 );


 app.use(express.json());
 app.use('/api/instructors', instructorRoutes);
 app.use("/api/fee", feeRoutes);
 // ======================================================
 // =============== NOTIFY ROUTES (EMAIL) ================
 // ======================================================

 // ======================================================
 // =============== EMAIL CONFIG (GMAIL) =================
 // ======================================================

 const mailTransporter = nodemailer.createTransport({
     service: process.env.MAIL_SERVICE || "gmail",
     auth: {
         user: process.env.MAIL_USER,
         pass: process.env.MAIL_PASS,
     },
 });

 async function sendAttendanceEmail({
     to,
     studentName,
     className,
     date,
     status,
     reason,
 }) {
     console.log("📧 Gửi email tới:", to);
     console.log("   - Học viên:", studentName);
     console.log("   - Lớp:", className);
     console.log("   - Ngày:", date);
     console.log("   - Trạng thái:", status);
     console.log("   - Lý do:", reason || "(không)");

     const subject = `[Thông báo điểm danh] Lớp ${className} - Ngày ${date}`;
     const text =
         `Xin chào ${studentName},\n\n` +
         `Kết quả điểm danh buổi học ngày ${date} cho lớp ${className}:\n` +
         `Trạng thái: ${status}\n` +
         (reason ? `Ghi chú: ${reason}\n` : "") +
         `\nTrân trọng,\nTrung tâm tiếng Trung`;

     try {
         await mailTransporter.sendMail({
             from: '"Trung tâm tiếng Trung" <sonlouisvu@gmail.com>',
             to,
             subject,
             text,
         });
         console.log("✅ Email gửi thành công!");
     } catch (err) {
         console.error("❌ Lỗi gửi email:", err.message);
     }
 }

 // test nhanh gửi mail
 app.get("/test-send", async(req, res) => {
     try {
         await sendAttendanceEmail({
             to: "anhkha19012004@gmail.com",
             studentName: "Test Student",
             className: "HSK2 - Cơ bản (C001)",
             date: "2025-11-21",
             status: "Có mặt",
             reason: "",
         });
         res.send("✅ Email test đã được gửi!");
     } catch (err) {
         console.error("Lỗi khi gửi email test:", err);
         res.status(500).send("❌ Lỗi: " + err.message);
     }
 });

 // ======================================================
 // 1) DEMO USER LOGIN
 // ======================================================

 app.post("/api/auth/login", async(req, res) => {
     const { username, password } = req.body;

     try {
         const [rows] = await db.execute(
             "SELECT username, password, role, active FROM users WHERE username = ?", [username]
         );

         if (rows.length === 0) {
             return res
                 .status(401)
                 .json({ message: "Sai tên đăng nhập hoặc mật khẩu" });
         }

         const user = rows[0];

         // Kiểm tra tài khoản có bị vô hiệu hóa không
         if (user.active === false || user.active === 0) {
             return res.status(403).json({ message: "Tài khoản đã bị vô hiệu hóa. Vui lòng liên hệ quản trị viên." });
         }

         // Compare hashed password
         const match = await bcrypt.compare(password, user.password);
         if (!match) {
             return res.status(401).json({ message: "Sai tên đăng nhập hoặc mật khẩu" });
         }

         return res.json({
             username: user.username,
             role: user.role,
         });
     } catch (err) {
         console.error("Lỗi khi đăng nhập:", err);
         return res.status(500).json({ message: "Lỗi server khi đăng nhập" });
     }
 });

 // ======================================================
 // 2) LỊCH HỌC HỌC VIÊN – LẤY TỪ CSDL THẬT
 // ======================================================

 app.get("/api/students/:username/schedule", async(req, res) => {
     // Returns upcoming sessions for a student.
     // :username may be either the login username or the numeric student id.
     // Query params: latestOnly=true (only upcoming sessions), limit=N (max N sessions)
     const { username } = req.params;
     const { latestOnly, limit } = req.query;
     const limitNum = limit ? parseInt(limit, 10) : 5;
     const onlyLatest = String(latestOnly || 'false').toLowerCase() === 'true';

     try {
         let studentId = null;

         // If numeric, treat as student id
         if (/^\d+$/.test(username)) {
             studentId = parseInt(username, 10);
         } else {
             // try to find mapping in users table (username -> student_id)
             try {
                 const [urows] = await db.execute('SELECT student_id FROM users WHERE username = ?', [username]);
                 if (urows && urows.length > 0) {
                     studentId = urows[0].student_id;
                 }
             } catch (e) {
                 // users table may not exist; fall through and return not found
                 console.warn('users table lookup failed or users table missing:', e.message);
             }
         }

         if (!studentId) {
             return res.status(404).json({ success: false, message: 'Không tìm thấy học viên' });
         }

         // 1) Sessions coming from class_sessions (class timetable)
         const [sessionRows] = await db.execute(
             `SELECT cs.date, cs.time_start, cs.time_end, c.name AS class_name, cs.room, cs.class_id
             FROM class_sessions cs
             JOIN classes c ON c.id = cs.class_id
             JOIN class_students cls ON cls.class_id = cs.class_id
             WHERE cls.student_id = ?
                 AND cs.date >= CURDATE()
             ORDER BY cs.date ASC`, [studentId]
         );

         // 2) Lấy lịch trực tiếp từ class_schedules của các lớp học viên đang học
         const [schedRows] = await db.execute(
             `SELECT cs.scheduled_at, cs.meta, cs.class_id, c.name as class_name
             FROM class_schedules cs
             INNER JOIN classes c ON c.id = cs.class_id
             INNER JOIN class_students cls ON cls.class_id = cs.class_id
             WHERE cls.student_id = ?
                 AND cs.scheduled_at IS NOT NULL
                 AND DATE(cs.scheduled_at) >= CURDATE()
             ORDER BY cs.scheduled_at ASC`, [studentId]
         );

         // Normalize both sets into a common shape and merge
         const normalized = [];
         const seen = new Map(); // dedup by classId+date+timeStart - prefer schedule over class_session

         // For schedule rows from class_schedules
         for (const s of schedRows) {
             let dateOnly = null;
             let timeOnly = null;
             let timeEnd = null;
             let room = null;

             // Parse meta
             let meta = {};
             try {
                 meta = s.meta ? (typeof s.meta === 'string' ? JSON.parse(s.meta) : s.meta) : {};
             } catch (e) {}

             // Get date and time from meta or scheduled_at
             if (meta.providedSessionDate) {
                 dateOnly = meta.providedSessionDate;
             }
             if (meta.start) {
                 timeOnly = meta.start;
             }
             if (meta.end) {
                 timeEnd = meta.end;
             }
             if (meta.room) {
                 room = meta.room;
             }

             // Fallback to scheduled_at if meta values are missing
             if (!dateOnly || !timeOnly) {
                 const dt = new Date(s.scheduled_at);
                 if (!isNaN(dt.getTime())) {
                     if (!dateOnly) dateOnly = dt.toISOString().slice(0, 10);
                     if (!timeOnly) timeOnly = dt.toISOString().slice(11, 16);
                 }
             }

             const key = `${s.class_id}|${dateOnly}|${timeOnly}`;
             seen.set(key, true);
             normalized.push({
                 date: dateOnly,
                 timeStart: timeOnly,
                 timeEnd: timeEnd,
                 className: s.class_name || null,
                 room: room,
                 source: 'class_schedule',
                 classId: s.class_id,
             });
         }

         // Only add class_sessions if not already in schedules
         for (const r of sessionRows) {
             const key = `${r.class_id}|${r.date}|${r.time_start}`;
             if (!seen.has(key)) {
                 normalized.push({
                     date: r.date,
                     timeStart: r.time_start,
                     timeEnd: r.time_end,
                     className: r.class_name,
                     room: r.room,
                     source: 'class_session',
                     classId: r.class_id,
                 });
             }
         }

         // Sort by date+time
         normalized.sort((a, b) => {
             const da = new Date(`${a.date}T${a.timeStart || '00:00'}:00Z`).getTime();
             const dbt = new Date(`${b.date}T${b.timeStart || '00:00'}:00Z`).getTime();
             return da - dbt;
         });

         // Apply latestOnly filter: only upcoming sessions
         let filtered = normalized;
         if (onlyLatest) {
             const now = new Date();
             filtered = normalized.filter(s => {
                 if (!s.date || !s.timeStart) return false;
                 const sessionTime = new Date(`${s.date}T${s.timeStart}:00`);
                 return sessionTime >= now;
             });
         }

         // Apply limit
         const result = filtered.slice(0, limitNum);

         return res.json({ success: true, schedule: result });
     } catch (err) {
         console.error('Lỗi lấy lịch học:', err);
         return res.status(500).json({ success: false, message: 'Lỗi server khi lấy lịch học' });
     }
 });

 // ======================================================
 // 3) THI THỬ HỌC VIÊN (ca thi, đăng ký, kết quả)
 // ======================================================

 const authRoutes = require("./routes/authRoutes");
 app.use('/api/auth', authRoutes);




 // ======================================================
 // MOUNT ROUTER QUẢN LÝ HỌC VIÊN (STAFF)
 // ======================================================
 // Đặt SAU các route /api/students/:username/... để không bị "nuốt" route.
 app.use("/api/students", studentRoutes);

 // Router cho quản lý lịch học: assign / finish -> tự động cập nhật trạng thái học viên
 app.use("/api/schedules", scheduleRoutes);

 // Router quản lý lớp (CRUD + assign/remove/finish)


 // Session/timetable routes
 app.use('/api', sessionRoutes);

 // Router quản lý nhân viên (CRUD + attendance summary)
 app.use('/api/employees', employeeRoutes);

 // Router chấm công nhân viên
 app.use('/api/attendance', attendanceRoutes);

 // Router quản lý khóa học
 app.use('/api/courses', courseRoutes);

 // Router quản lý giảng viên

 app.use("/api/classes", classRoutes);
 // Router gửi thông báo/email
 app.use('/api/notify', notifyRoutes);

 // Router quản lý học phí (hoá đơn, thanh toán)
 app.use('/api/fee', feeRoutes);


 // ======================================================
 const getClassListByStatus = async(req, res, status) => {
     const u = req.params.username || req.query.username;

     try {
         // 1. Lấy instructor_id từ username
         const [instructors] = await db.query(
             `SELECT i.id as instructor_id 
             FROM instructors i
             INNER JOIN users u ON u.id = i.user_id
             WHERE u.username = ?`, [u]
         );

         if (instructors.length === 0) {
             return res.json({ success: true, data: [] });
         }

         const instructorId = instructors[0].instructor_id;

         let dateCondition = "";

         // Xác định điều kiện lọc
         if (status === 'UPCOMING') {
             dateCondition = "c.start_date > CURDATE()";
         } else if (status === 'ONGOING') {
             dateCondition = "c.start_date <= CURDATE() AND (c.end_date IS NULL OR c.end_date >= CURDATE())";
         } else if (status === 'FINISHED') {
             dateCondition = "c.end_date IS NOT NULL AND c.end_date < CURDATE()";
         } else {
             return res.status(400).json({ success: false, message: 'Invalid status' });
         }

         // QUERY SQL NÂNG CẤP:
         // 1. Lấy đủ start_date, end_date.
         // 2. Dùng Subquery để lấy 'room' từ bảng class_schedules (tránh join nhiều gây lỗi group by).
         // 3. Đếm số học viên (student_count).
         const sql = `
            SELECT 
                c.id,
                c.name,
                c.level,
                c.start_date,
                c.end_date,
                
                -- Lấy phòng học từ lịch học đầu tiên
                (SELECT meta FROM class_schedules sch WHERE sch.class_id = c.id ORDER BY sch.scheduled_at ASC LIMIT 1) as first_schedule_meta,
                
                -- Đếm số học viên đang học
                COUNT(cs.student_id) as student_count
            FROM classes c
            INNER JOIN class_teachers ct ON ct.class_id = c.id
            LEFT JOIN class_students cs ON cs.class_id = c.id AND cs.status = 'ACTIVE'
            WHERE ct.teacher_id = ? AND ${dateCondition}
            GROUP BY c.id, c.name, c.level, c.start_date, c.end_date
            ORDER BY c.start_date ${status === 'FINISHED' ? 'DESC' : 'ASC'}
        `;

         const [rows] = await db.query(sql, [instructorId]);

         // XỬ LÝ DỮ LIỆU TRƯỚC KHI TRẢ VỀ (Parse JSON phòng học)
         const classes = rows.map(cls => {
             let room = "Chưa xếp";

             // Giải mã JSON meta để lấy phòng
             if (cls.first_schedule_meta) {
                 try {
                     const metaObj = typeof cls.first_schedule_meta === 'string' ?
                         JSON.parse(cls.first_schedule_meta) :
                         cls.first_schedule_meta;
                     if (metaObj && metaObj.room) room = metaObj.room;
                 } catch (e) {}
             }

             return {
                 id: cls.id,
                 name: cls.name,
                 startDate: cls.start_date, // Frontend cần trường này
                 endDate: cls.end_date, // Frontend cần trường này (trước đây bị NULL)
                 room: room, // Frontend cần trường này
                 students: cls.student_count || 0,
                 level: cls.level,
                 totalSessions: 0 // Placeholder nếu chưa tính toán
             };
         });

         return res.json({ success: true, data: classes });

     } catch (err) {
         console.error(`❌ GET /api/teacher/classes/${status} error:`, err);
         return res.status(500).json({ success: false, message: 'Lỗi server khi lấy danh sách lớp.' });
     }
 };
 // Đặt lại 3 API routes
 app.get("/api/teacher/classes/upcoming", (req, res) => getClassListByStatus(req, res, 'UPCOMING'));
 app.get("/api/teacher/classes/ongoing", (req, res) => getClassListByStatus(req, res, 'ONGOING'));
 app.get("/api/teacher/classes/finished", (req, res) => getClassListByStatus(req, res, 'FINISHED'));

 // ==========const getClass============================================
 // 5) LỊCH GIẢNG DẠY CỦA GIÁO VIÊN (DEMO FIXED DATA)
 // ======================================================

 const teacherTeachingSchedule = {
     teacher1: [{
             id: 1,
             classId: 201,
             className: "HSK2 - Cơ bản (Lớp 05)",
             date: "2025-11-10",
             timeStart: "18:00",
             timeEnd: "19:30",
             room: "P201",
             topic: "Ngữ pháp cơ bản",
             materials: ["Slide1.pdf"],
             notes: "Ổn định",
         },
         {
             id: 2,
             classId: 201,
             className: "HSK2 - Cơ bản (Lớp 05)",
             date: "2025-11-12",
             timeStart: "18:00",
             timeEnd: "19:30",
             room: "P201",
             topic: "Luyện đọc",
             materials: ["Reading.pdf"],
             notes: "Tiến bộ tốt",
         },
     ],
 };

 // API: Lấy danh sách lớp để giáo viên chọn trong phần Điểm danh
 app.get("/api/teacher/:username/classes", async(req, res) => {
     const { username } = req.params;
     try {
         // 1. Lấy đúng instructor_id được lưu trong bảng users
         const [users] = await db.query(
             `SELECT instructor_id FROM users WHERE username = ?`, [username]
         );

         if (users.length === 0 || !users[0].instructor_id) {
             return res.json({ success: true, classes: [] });
         }

         const instructorId = users[0].instructor_id;

         // 2. Truy vấn danh sách lớp mà giảng viên này phụ trách
         const [classes] = await db.query(
             `SELECT DISTINCT c.id, c.name, c.level, c.start_date, c.end_date
             FROM class_teachers ct
             INNER JOIN classes c ON c.id = ct.class_id
             WHERE ct.teacher_id = ?
             ORDER BY c.name ASC`, [instructorId]
         );

         return res.json({
             success: true,
             classes: classes.map(c => ({
                 id: c.id,
                 name: c.name,
                 level: c.level,
                 startDate: c.start_date,
                 endDate: c.end_date
             }))
         });
     } catch (err) {
         console.error('❌ Lỗi GET /api/teacher/:username/classes:', err);
         return res.status(500).json({ success: false, message: 'Lỗi server' });
     }
 });

 const CLASS_STUDENTS = {
     C001: [
         { id: "S001", name: "Nguyen Van A", email: "tanletrongtan52@gmail.com" },
         { id: "S002", name: "Tran Thi B", email: "anhkha19012004@gmail.com" },
     ],
     C002: [
         { id: "S003", name: "Le Van C", email: "anhkha19012004@gmail.com" },
     ],
 };

 let attendanceSessionAutoId = 1;
 let attendanceRecordAutoId = 1;

 const ATTENDANCE_SESSIONS = []; // { id, classId, date, note }
 const ATTENDANCE_RECORDS = []; // { id, sessionId, studentId, status, recordedAt, reason }

 // 1) Lấy danh sách học viên của một lớp
 // 1) Lấy danh sách học viên của một lớp (CHỈ LẤY HỌC VIÊN ĐANG HỌC - ACTIVE)
 // 1) Lấy danh sách học viên của một lớp (LẤY TẤT CẢ - KHÔNG PHÂN BIỆT TRẠNG THÁI)
 // ======================================================
 // 1) API LẤY DANH SÁCH HỌC VIÊN (Chuẩn hoá trả về Mảng)
 // ======================================================
 // 1) Lấy danh sách học viên (Trả về mảng trực tiếp)
 app.get("/api/classes/:classId/students", async(req, res) => {
     const { classId } = req.params;
     console.log(`🔍 Đang lấy học viên cho lớp ID: ${classId}...`);

     try {
         const [students] = await db.query(
             `SELECT 
                s.id, 
                s.full_name, 
                s.phone, 
                s.email, 
                cs.status as class_status
             FROM class_students cs
             INNER JOIN students s ON s.id = cs.student_id
             WHERE cs.class_id = ? 
             ORDER BY s.full_name ASC`, [classId]
         );

         console.log(`✅ Tìm thấy ${students.length} học viên.`);
         res.json(students); // Trả về luôn: [ {id: 1...}, {id: 2...} ]
     } catch (err) {
         console.error('❌ Lỗi:', err);
         res.json([]); // Lỗi thì trả về mảng rỗng để không crash
     }
 });
 // 2) Lấy danh sách buổi điểm danh theo lớp
 app.get("/api/attendance/sessions", (req, res) => {
     const { classId } = req.query;
     const sessions = ATTENDANCE_SESSIONS.filter((s) => s.classId === classId);
     res.json(sessions);
 });

 // 3) Tạo buổi dạy mới
 app.post("/api/attendance/sessions", (req, res) => {
     const { classId, date, note } = req.body;
     if (!classId || !date) {
         return res.status(400).json({ message: "Thiếu classId hoặc date" });
     }

     const newSession = {
         id: `AS${attendanceSessionAutoId++}`,
         classId,
         date,
         note: note || "",
     };
     ATTENDANCE_SESSIONS.push(newSession);
     res.status(201).json(newSession);
 });

 // 4) Lưu kết quả điểm danh + (tuỳ chọn) gửi email thông báo
 app.post("/api/attendance/sessions/:sessionId/records", async(req, res) => {
     const { sessionId } = req.params;
     const { records, sendNotification } = req.body;

     console.log(">>> API saveAttendanceRecords:", {
         sessionId,
         sendNotification,
         recordsLength: Array.isArray(records) ? records.length : null,
     });

     if (!Array.isArray(records)) {
         return res.status(400).json({ message: "records phải là mảng" });
     }

     const now = new Date().toISOString();

     const created = records.map((r) => {
         const rec = {
             id: `AR${attendanceRecordAutoId++}`,
             sessionId,
             studentId: r.studentId,
             status: r.status,
             reason: r.reason || "",
             recordedAt: now,
         };
         ATTENDANCE_RECORDS.push(rec);
         return rec;
     });

     if (sendNotification) {
         try {
             let classId = "UNKNOWN";
             let date = new Date().toISOString().split("T")[0];
             let className = "Unknown Class";

             const session = ATTENDANCE_SESSIONS.find((s) => s.id === sessionId);
             if (session) {
                 classId = session.classId || classId;
                 date = session.date || date;

                 // Lấy tên lớp thật từ database
                 const [classInfo] = await db.query(`
                    SELECT name FROM classes WHERE id = ? LIMIT 1
                `, [classId]);

                 if (classInfo.length > 0) {
                     className = classInfo[0].name;
                 } else {
                     className = classId; // fallback to ID if not found
                 }
             } else {
                 console.log(
                     "Không tìm thấy session để gửi email, dùng giá trị mặc định:",
                     sessionId
                 );
             }

             // Lấy học viên từ database thay vì mock data
             const [studentsFromDB] = await db.query(`
                SELECT 
                    s.id,
                    s.full_name,
                    s.email
                FROM class_students cs
                JOIN students s ON cs.student_id = s.id
                WHERE cs.class_id = ? AND cs.status = 'ACTIVE'
            `, [classId]);

             const promises = created
                 .map((rec) => {
                     const student = studentsFromDB.find((s) => s.id === rec.studentId);
                     if (!student || !student.email) {
                         console.log(
                             `Không tìm thấy email cho studentId=${rec.studentId}`
                         );
                         return null;
                     }

                     return sendAttendanceEmail({
                         to: student.email,
                         studentName: student.full_name,
                         className,
                         date,
                         status: rec.status,
                         reason: rec.reason,
                     });
                 })
                 .filter(Boolean);

             await Promise.all(promises);
             console.log("Đã gửi xong email thông báo điểm danh.");
         } catch (err) {
             console.error("Lỗi khi gửi email thông báo:", err);
         }
     }

     return res.status(201).json(created);
 });
 // ... (Các API cũ giữ nguyên)

 // 5) [MỚI] Lấy lịch sử điểm danh của một buổi
 app.get("/api/attendance/sessions/:sessionId/records", (req, res) => {
     const { sessionId } = req.params;

     // Tìm các bản ghi trong bộ nhớ tạm (ATTENDANCE_RECORDS)
     // Lưu ý: sessionId trong mảng có thể là chuỗi hoặc số, nên dùng == để so sánh
     const records = ATTENDANCE_RECORDS.filter(r => r.sessionId == sessionId);

     return res.json({ success: true, records });
 });

 // ... (Các phần khác giữ nguyên)
 // ======================================================
 // TEST API
 // ======================================================

 app.get("/", (req, res) => {
     res.send("Backend English Center đang chạy!");
 });

 // ======================================================
 // START SERVER (only when run directly)
 // ======================================================
 // --- API KHẨN CẤP ĐỂ SỬA DATABASE ---
 // --- API KHẨN CẤP: CẬP NHẬT DATABASE AN TOÀN ---
 app.get('/setup-db-final', async(req, res) => {
     try {
         // 1. Kiểm tra và thêm cột instructor_id vào bảng users
         const [userCols] = await db.query("SHOW COLUMNS FROM users LIKE 'instructor_id'");
         if (userCols.length === 0) {
             await db.query("ALTER TABLE users ADD COLUMN instructor_id INT DEFAULT NULL");
             console.log("✅ Đã thêm cột instructor_id vào bảng users");
         }

         // 2. Kiểm tra và thêm cột type vào bảng instructors
         const [insCols] = await db.query("SHOW COLUMNS FROM instructors LIKE 'type'");
         if (insCols.length === 0) {
             // Thêm cột type sau cột full_name
             await db.query("ALTER TABLE instructors ADD COLUMN type ENUM('VIETNAMESE', 'NATIVE') DEFAULT 'VIETNAMESE' AFTER full_name");
             console.log("✅ Đã thêm cột type vào bảng instructors");
         }

         res.send(`
            <div style="font-family: sans-serif; padding: 40px; text-align: center;">
                <h1 style="color: #10b981;">✅ Cấu trúc Database đã được cập nhật!</h1>
                <p style="color: #4b5563; font-size: 18px;">Bây giờ bạn có thể quay lại trang Dashboard để thêm Giảng viên.</p>
                <p style="color: #ef4444;"><b>Lưu ý:</b> Hãy dùng Email và SĐT mới để tránh lỗi trùng lặp dữ liệu cũ.</p>
                <a href="http://localhost:5173/staff/dashboard" style="display: inline-block; margin-top: 20px; padding: 10px 20px; background: #4f46e5; color: white; text-decoration: none; border-radius: 8px;">Quay lại Dashboard</a>
            </div>
        `);
     } catch (err) {
         console.error("❌ Lỗi cập nhật DB:", err);
         res.status(500).send(`<h1>❌ Lỗi: ${err.message}</h1>`);
     }
 });
 if (require.main === module) {
     app.listen(PORT, () => {
         console.log(`Backend đang chạy tại http://localhost:${PORT}`);
     });
 }
 // --- API TẠM ĐỂ SỬA LỖI DATABASE (CHẠY 1 LẦN) ---

 // Export app for testing
 module.exports = app;