// backend/db.js
const mysql = require("mysql2/promise");

const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '123456789', // Đảm bảo khớp với docker-compose
    database: process.env.DB_NAME || 'english_center',
    connectionLimit: process.env.DB_POOL ? parseInt(process.env.DB_POOL) : 10,
    multipleStatements: true,
});

module.exports = pool;