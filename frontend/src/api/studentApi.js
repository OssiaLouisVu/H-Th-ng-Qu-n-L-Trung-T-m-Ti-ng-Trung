// frontend/src/api/studentApi.js
const API_BASE = "http://localhost:8080";

// Hàm tổng quát: tìm học viên theo status + keyword
export async function searchStudents({ status = "", keyword = "" } = {}) {
    const params = new URLSearchParams();
    if (status) params.append("status", status);
    if (keyword) params.append("keyword", keyword);

    const res = await fetch(`${API_BASE}/api/students?${params.toString()}`);

    // Nếu backend chết / 404 / 500 -> ném lỗi để component bắt
    if (!res.ok) {
        throw new Error(`HTTP error ${res.status}`);
    }

    // Backend trả về dạng { success, students, message? }
    return res.json();
}

// --- Học viên mới (NEW) ---
export async function searchNewStudents(keyword) {
    return searchStudents({ status: "NEW", keyword });
}

// --- Học viên đang học (ACTIVE) ---
export async function searchActiveStudents(keyword) {
    return searchStudents({ status: "ACTIVE", keyword });
}

// --- Học viên đã học (COMPLETED) ---
export async function searchCompletedStudents(keyword) {
    return searchStudents({ status: "COMPLETED", keyword });
}

// --- Tạo mới học viên ---
export async function createStudent(payload) {
    const res = await fetch(`${API_BASE}/api/students`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });
    return res.json();
}

// --- Cập nhật học viên (sửa + đổi trạng thái) ---
export async function updateStudent(id, payload) {
    const res = await fetch(`${API_BASE}/api/students/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });
    return res.json();
}

// --Sếp lớp ---
export async function assignSchedule(payload) {
    const res = await fetch(`${API_BASE}/api/schedules/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });
    return res.json();
}

export async function finishSchedule(payload) {
    const res = await fetch(`${API_BASE}/api/schedules/finish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });
    return res.json();
}