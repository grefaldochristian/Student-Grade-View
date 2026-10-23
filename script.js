/* ==========================================================
   VERITAS COLLEGE OF IROSIN
   STUDENT GRADE VIEWING & MANAGEMENT PORTAL
   Vanilla JavaScript + localStorage  (v4)

   Sections
     1. Configuration and helpers
     2. Data storage (accounts, students, grades, announcements, audit)
     3. Security (hashing, password rules, login lock, audit log)
     4. Toasts, dialogs and field errors
     5. Privacy: no autofill popups, forms always cleared
     6. Input rules (student ID numbers only, full-name formatting)
     7. Programs and year levels
     8. Login and registration
     9. Navigation
    10. Grade computation (final grade, GWA, standing)
    11. Dashboard
    12. View grades
    13. Grade encoding (registrar)
    14. Student information management (registrar)
    15. Reports
    16. Announcements
    17. Profile and change password
    18. CSV export
    19. Events, idle logout and startup

   NOTE: This is a front-end prototype. Everything lives in the
   browser, so it is NOT real security.
   ========================================================== */

document.addEventListener("DOMContentLoaded", () => {
  "use strict";

  /* ==========================================================
     1. CONFIGURATION AND HELPERS
     ========================================================== */

  const $ = (id) => document.getElementById(id);
  
  // ==========================================================
  // SOUND EFFECTS - VERITAS GRADE PORTAL
  // ==========================================================

  let portalAudioContext = null;

  function playPortalSound(type = "student") {
    try {
      const AudioContextClass =
        window.AudioContext || window.webkitAudioContext;

      if (!AudioContextClass) return;

      if (!portalAudioContext) {
        portalAudioContext = new AudioContextClass();
      }

      const audio = portalAudioContext;

      function playNote(frequency, delay, duration, volume = 0.07) {
        const oscillator = audio.createOscillator();
        const gain = audio.createGain();
        const start = audio.currentTime + delay;

        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(frequency, start);

        gain.gain.setValueAtTime(0.001, start);
        gain.gain.exponentialRampToValueAtTime(
          volume,
          start + 0.025
        );
        gain.gain.exponentialRampToValueAtTime(
          0.001,
          start + duration
        );

        oscillator.connect(gain);
        gain.connect(audio.destination);

        oscillator.start(start);
        oscillator.stop(start + duration + 0.03);
      }

      const playSequence = () => {
        if (type === "register") {
          // Three cheerful notes for successful registration
          playNote(523.25, 0, 0.13);
          playNote(659.25, 0.15, 0.13);
          playNote(783.99, 0.30, 0.22);
        } else if (type === "registrar") {
          // Different confirmation sound for registrar
          playNote(440, 0, 0.16);
          playNote(659.25, 0.19, 0.24);
        } else {
          // Student login success
          playNote(587.33, 0, 0.14);
          playNote(783.99, 0.17, 0.24);
        }
      };

      if (audio.state === "suspended") {
        audio.resume().then(playSequence).catch(() => {});
      } else {
        playSequence();
      }
    } catch (error) {
      // Sound errors must not stop the portal.
      console.warn("Portal sound could not play:", error);
    }
  }


  const KEYS = {
    users: "veritas_demo_accounts",
    grades: "veritas_grades_db",
    students: "veritas_students",
    session: "veritas_grade_session",
    announcements: "veritas_grade_announcements",
    audit: "veritas_audit_log",
    lock: "veritas_login_lock"
  };

  const ROLE_REG = "registrar";
  const ROLE_STU = "student";

  const PASSING_GRADE = 3.0;   // 1.00 is the best grade, 3.00 is the lowest pass
  const WEIGHTS = { prelim: 0.30, midterm: 0.30, final: 0.40 };

  // Percentage -> equivalent grade (first row that matches wins)
  const GRADE_SCALE = [
    [97, 1.00], [94, 1.25], [91, 1.50], [88, 1.75], [85, 2.00],
    [82, 2.25], [79, 2.50], [76, 2.75], [75, 3.00]
  ];

  const MAX_ATTEMPTS = 3;      // wrong logins before a lock
  const BASE_LOCK_SECONDS = 5; // doubles each time, up to  5 seconds
  const MAX__LOCK_SECONDS = 5;
  const IDLE_MINUTES = 15;
  const MIN_PASSWORD = 8;

  const STUDENT_ID_PATTERN = /^\d{4}-\d{4}$/;
  const NAME_PATTERN = /^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ.'-]*(?: [A-Za-zÀ-ÿ][A-Za-zÀ-ÿ.'-]*)+$/;

  let selectedRole = ROLE_STU;
  let authMode = "login";
  let currentUser = null;
  let currentPage = "home";
  let toastCounter = 0;
  let lastActivity = Date.now();

  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  const norm = (value) => String(value ?? "").trim().toLowerCase();
  const isRegistrar = () => currentUser?.role === ROLE_REG;

  function generateId(prefix = "record") {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return `${prefix}-${window.crypto.randomUUID()}`;
    }
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  const byText = (a, b) =>
    String(a ?? "").localeCompare(String(b ?? ""), undefined, { numeric: true, sensitivity: "base" });

  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" });
  }

  function formatDateTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleString("en-PH", {
      year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"
    });
  }

  const formatGrade = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? n.toFixed(2) : "—";
  };

  const formatPercent = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? `${n.toFixed(2)}%` : "—";
  };

  const initials = (name) => (String(name || "U").trim().charAt(0) || "U").toUpperCase();

  /* ==========================================================
     2. DATA STORAGE
     ========================================================== */

  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return fallback;
      const parsed = JSON.parse(raw);
      return parsed ?? fallback;
    } catch (error) {
      console.error("Could not read storage:", key, error);
      return fallback;
    }
  }

  function writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      console.error("Could not save storage:", key, error);
      showToast("Unable to save data. Check your browser storage settings.", "error");
      return false;
    }
  }

  const readArray = (key) => {
    const value = readJSON(key, []);
    return Array.isArray(value) ? value : [];
  };

  /* ---------- Accounts ---------- */

  const getUsers = () => readArray(KEYS.users).filter((u) => u && u.identifier && u.role);
  const saveUsers = (list) => writeJSON(KEYS.users, list);

  function getUserByIdentifier(identifier) {
    const wanted = norm(identifier);
    return getUsers().find((user) => norm(user.identifier) === wanted);
  }

  function createAccount(fields, password) {
    const salt = makeSalt();
    return {
      id: generateId("user"),
      ...fields,
      salt,
      passHash: hashPassword(password, salt),
      createdAt: new Date().toISOString(),
      lastLogin: null
    };
  }

  /** Make sure the two demo accounts exist, and move any old plain-text
      passwords to salted hashes. */
  function initializeAccounts() {
    let users = readArray(KEYS.users);
    let changed = false;

    users = users.map((user) => {
      if (user && typeof user.password === "string") {
        const salt = makeSalt();
        const upgraded = { ...user, salt, passHash: hashPassword(user.password, salt) };
        delete upgraded.password;
        changed = true;
        return upgraded;
      }
      return user;
    });

    const valid = users.filter((u) => u && u.identifier && u.role && u.passHash && u.salt);
    if (valid.length !== users.length) changed = true;
    users = valid;

    if (!users.some((u) => norm(u.identifier) === "admin@veritas.edu.ph")) {
      users.push(createAccount({
        fullName: "Veritas Registrar",
        identifier: "admin@veritas.edu.ph",
        role: ROLE_REG,
        program: "Registrar Office",
        year: ""
      }, "admin123"));
      changed = true;
    }

    if (!users.some((u) => u.identifier === "2024-6348")) {
      users.push(createAccount({
        fullName: "Christian D. Grefaldo",
        identifier: "2024-6348",
        role: ROLE_STU,
        program: "BSIT",
        year: "2"
      }, "student123"));
      changed = true;
    }

    if (changed || localStorage.getItem(KEYS.users) === null) saveUsers(users);
  }

  /* ---------- Student records ---------- */

  const getStudents = () =>
    readArray(KEYS.students).filter((s) => s && s.studentId && s.fullName);
  const saveStudents = (list) => writeJSON(KEYS.students, list);

  function getStudentRecord(studentId) {
    return getStudents().find((s) => s.studentId === studentId) || null;
  }

  function getStudentName(studentId) {
    const record = getStudentRecord(studentId);
    return record ? record.fullName : studentId;
  }

  /** Every student with an account or a grade needs a student record. */
  function syncStudents() {
    const list = getStudents();
    const known = new Set(list.map((s) => s.studentId));
    let changed = false;

    const add = (studentId, fullName, program, year) => {
      if (!studentId || known.has(studentId)) return;
      known.add(studentId);
      list.push({
        studentId,
        fullName: formatName(fullName || studentId),
        program: program || "BSIT",
        year: String(year || "1"),
        email: "",
        contact: "",
        status: "Active",
        createdAt: new Date().toISOString()
      });
      changed = true;
    };

    getUsers().filter((u) => u.role === ROLE_STU).forEach((u) =>
      add(u.identifier, u.fullName, u.program, u.year)
    );

    getGrades().forEach((g) => add(g.studentId, g.studentName, g.program, g.year));

    if (changed) saveStudents(list);
  }

  /* ---------- Grades ---------- */

  /** The sample file and older versions use slightly different field
      names. This turns every record into one standard shape. */
  function normalizeGrade(raw) {
    if (!raw || !raw.id || !raw.studentId) return null;

    let semester = raw.semester;
    let schoolYear = raw.schoolYear;

    if (!semester && raw.period) {
      const text = String(raw.period);
      semester = /summer/i.test(text) ? "Summer" : /2nd/i.test(text) ? "2nd Semester" : "1st Semester";
      schoolYear = (text.match(/\d{4}-\d{4}/) || text.match(/\d{4}/) || [""])[0];
    }

    const grade = Number(raw.grade);
    const units = Number(raw.units);
    if (!Number.isFinite(grade) || !Number.isFinite(units)) return null;

    const score = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

    return {
      id: String(raw.id),
      studentId: String(raw.studentId).trim(),
      studentName: raw.studentName || "",
      program: raw.program || "",
      year: String(raw.year ?? raw.yearLevel ?? ""),
      subjectCode: String(raw.subjectCode || "").toUpperCase(),
      description: raw.description ?? raw.subjectDescription ?? "",
      units,
      grade,
      semester: semester || "1st Semester",
      schoolYear: schoolYear || "2025-2026",
      prelim: score(raw.prelim),
      midterm: score(raw.midterm),
      final: score(raw.final),
      finalPercent: score(raw.finalPercent)
    };
  }

  const getGrades = () => readArray(KEYS.grades).map(normalizeGrade).filter(Boolean);
  const saveGrades = (list) => writeJSON(KEYS.grades, list);

  /** Save grade records in the standard shape (one-time upgrade). */
  function migrateGrades() {
    if (localStorage.getItem(KEYS.grades) === null) {
      const seed = typeof INITIAL_GRADE_DATASET !== "undefined" ? INITIAL_GRADE_DATASET : [];
      saveGrades(seed.map(normalizeGrade).filter(Boolean));
      return;
    }
    saveGrades(getGrades());
  }

  /* ---------- Announcements ---------- */

  const DEFAULT_ANNOUNCEMENTS = [
    {
      id: "announcement-1",
      title: "Welcome to the Academic Grade Portal",
      message: "Welcome to the Veritas College of Irosin Student Grade Viewing and Management Portal. Please check your academic records regularly.",
      date: "2026-10-01T08:00:00.000Z"
    },
    {
      id: "announcement-2",
      title: "Verify Your Student Information",
      message: "Make sure your registered name, student ID, and program are correct. Contact the registrar for assistance with official record corrections.",
      date: "2026-10-02T08:00:00.000Z"
    },
    {
      id: "announcement-3",
      title: "Academic Records Reminder",
      message: "Grades shown in this prototype are demonstration records. Confirm official grades with the registrar.",
      date: "2026-10-03T08:00:00.000Z"
    }
  ];

  function getAnnouncements() {
    if (localStorage.getItem(KEYS.announcements) === null) return DEFAULT_ANNOUNCEMENTS;
    return readArray(KEYS.announcements).filter((a) => a && a.id && a.title);
  }
  const saveAnnouncements = (list) => writeJSON(KEYS.announcements, list);

  function initializeStorage() {
    initializeAccounts();
    migrateGrades();
    syncStudents();
    if (localStorage.getItem(KEYS.announcements) === null) saveAnnouncements(DEFAULT_ANNOUNCEMENTS);
  }

  /* ==========================================================
     3. SECURITY
     ========================================================== */

  function makeSalt() {
    try {
      const bytes = new Uint8Array(8);
      window.crypto.getRandomValues(bytes);
      return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
    } catch (error) {
      return Math.random().toString(16).slice(2, 12) + Date.now().toString(16);
    }
  }

  /** Small salted hash (cyrb53, repeated). Demo only - not real security. */
  function cyrb53(text, seed = 0) {
    let h1 = 0xdeadbeef ^ seed;
    let h2 = 0x41c6ce57 ^ seed;

    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      h1 = Math.imul(h1 ^ code, 2654435761);
      h2 = Math.imul(h2 ^ code, 1597334677);
    }

    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);

    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
  }

  function hashPassword(password, salt) {
    let out = `${salt}:${password}`;
    for (let round = 0; round < 3; round++) out = cyrb53(out + salt, round).toString(16);
    return out;
  }

  const passwordMatches = (user, password) =>
    Boolean(user && user.salt && user.passHash === hashPassword(password, user.salt));

  /** Returns a message when the password is too weak, otherwise "". */
  function passwordProblem(password) {
    if (password.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`;
    if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return "Use both letters and numbers.";
    return "";
  }

  function passwordStrength(password) {
    let score = 0;
    if (password.length >= MIN_PASSWORD) score++;
    if (password.length >= 12) score++;
    if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
    if (/\d/.test(password) && /[A-Za-z]/.test(password)) score++;
    if (/[^A-Za-z0-9]/.test(password)) score++;
    return score;
  }

  /* ---------- Login lock ---------- */

  function getLock() {
    const lock = readJSON(KEYS.lock, {});
    return { attempts: Number(lock.attempts) || 0, until: Number(lock.until) || 0, level: Number(lock.level) || 0 };
  }

  const lockSecondsLeft = () => Math.max(0, Math.ceil((getLock().until - Date.now()) / 1000));

  function registerFailedLogin(identifier) {
    const lock = getLock();
    lock.attempts += 1;

    logAudit("Login failed", `Attempt ${lock.attempts} for "${String(identifier).slice(0, 40)}"`, "Anonymous");

    if (lock.attempts >= MAX_ATTEMPTS) {
      lock.level += 1;
      const seconds = Math.min(300, BASE_LOCK_SECONDS * 5 ** (lock.level - 1));
      writeJSON(KEYS.lock, { attempts: 0, level: lock.level, until: Date.now() + seconds * 1000 });
      startLockCountdown();
      showToast(`Too many failed attempts. Login is locked for ${seconds} seconds.`, "error");
      return;
    }

    writeJSON(KEYS.lock, lock);
    showToast(
      `Invalid credentials. Check the ID/e-mail, password and selected portal. (Attempt ${lock.attempts} of ${MAX_ATTEMPTS})`,
      "error"
    );
  }

  const clearLock = () => writeJSON(KEYS.lock, { attempts: 0, until: 0, level: 0 });

  let lockTimer = null;

  function startLockCountdown() {
    window.clearInterval(lockTimer);
    const note = $("auth-lock-note");
    const button = $("auth-submit-btn");

    const tick = () => {
      const left = lockSecondsLeft();

      if (left <= 0) {
        window.clearInterval(lockTimer);
        note.classList.add("hidden");
        button.disabled = false;
        return;
      }

      note.textContent = `Too many failed attempts. Please wait ${left} second${left === 1 ? "" : "s"} before trying again.`;
      note.classList.remove("hidden");
      button.disabled = authMode === "login";
    };

    tick();
    if (lockSecondsLeft() > 0) lockTimer = window.setInterval(tick, 1000);
  }

  /* ---------- Audit log ---------- */

  function logAudit(action, detail = "", actor) {
    const who = actor || (currentUser ? `${currentUser.fullName} (${currentUser.identifier})` : "System");
    const list = readArray(KEYS.audit);
    list.unshift({ time: new Date().toISOString(), actor: who, action, detail });
    writeJSON(KEYS.audit, list.slice(0, 150));
  }

  /* ==========================================================
     4. TOASTS, DIALOGS AND FIELD ERRORS
     ========================================================== */

  function showToast(message, type = "info") {
    const container = $("toast-container");
    if (!container) return;

    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.setAttribute("role", "status");
    toast.textContent = message;
    toast.dataset.toastId = String(++toastCounter);

    container.appendChild(toast);
    while (container.children.length > 4) container.firstElementChild.remove();

    window.setTimeout(() => toast.remove(), 4000);
  }

  let lastFocused = null;
  let confirmResolver = null;

  function openModal(id) {
    const modal = $(id);
    if (!modal) return;

    lastFocused = document.activeElement;
    modal.classList.remove("hidden");
    document.body.classList.add("modal-open");

    const target = modal.querySelector("input:not([type=hidden]), select, textarea, button");
    window.setTimeout(() => target?.focus(), 30);
  }

  function closeModal(id) {
    const modal = $(id);
    if (!modal || modal.classList.contains("hidden")) return;

    modal.classList.add("hidden");

    if (id === "modal-confirm" && confirmResolver) {
      const resolve = confirmResolver;
      confirmResolver = null;
      resolve(false);
    }

    if (!document.querySelector(".modal-backdrop:not(.hidden)")) {
      document.body.classList.remove("modal-open");
    }

    if (lastFocused && document.contains(lastFocused)) lastFocused.focus();
  }

  function closeAllModals() {
    document.querySelectorAll(".modal-backdrop").forEach((m) => closeModal(m.id));
  }

  /** Replacement for window.confirm(). Resolves true or false. */
  function askConfirm({ title, message, confirmLabel = "Delete" }) {
    return new Promise((resolve) => {
      if (confirmResolver) confirmResolver(false);
      confirmResolver = resolve;

      $("confirm-title").textContent = title;
      $("confirm-message").textContent = message;
      $("confirm-yes").textContent = confirmLabel;
      openModal("modal-confirm");
    });
  }

  function answerConfirm(value) {
    const resolve = confirmResolver;
    confirmResolver = null;
    closeModal("modal-confirm");
    if (resolve) resolve(value);
  }

  function trapFocus(event) {
    if (event.key !== "Tab") return;

    const open = document.querySelectorAll(".modal-backdrop:not(.hidden)");
    if (!open.length) return;

    const items = [...open[open.length - 1].querySelectorAll("button, input, select, textarea")]
      .filter((item) => !item.disabled && item.offsetParent !== null && item.type !== "hidden");
    if (!items.length) return;

    const first = items[0];
    const last = items[items.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  /* ---------- Inline field errors ---------- */

  function setFieldError(input, message) {
    const group = input?.closest(".input-group");
    if (!group) return;

    let note = group.querySelector(".field-error");
    group.classList.toggle("has-error", Boolean(message));

    if (message) input.setAttribute("aria-invalid", "true");
    else input.removeAttribute("aria-invalid");

    if (!message) {
      note?.remove();
      return;
    }

    if (!note) {
      note = document.createElement("p");
      note.className = "field-error";
      note.setAttribute("role", "alert");
      group.appendChild(note);
    }

    note.textContent = message;
  }

  function clearFieldErrors(root) {
    root.querySelectorAll(".input-group.has-error").forEach((group) => {
      group.classList.remove("has-error");
      group.querySelector(".field-error")?.remove();
    });
    root.querySelectorAll("[aria-invalid]").forEach((i) => i.removeAttribute("aria-invalid"));
  }

  /** errors = [[input, "message"], ...]. Returns true when there are none. */
  function applyErrors(root, errors) {
    clearFieldErrors(root);
    errors.forEach(([input, message]) => setFieldError(input, message));
    if (errors.length) errors[0][0].focus();
    return errors.length === 0;
  }

  /* ==========================================================
     5. PRIVACY: NO AUTOFILL POPUPS, FORMS ALWAYS CLEARED
     ========================================================== */

  /*
    Browsers show a saved e-mail / account list when they think a box
    is a login or address field. These measures stop it:
      - autocomplete is off (and set to an unknown value on text boxes)
      - each box gets a random name, so form history cannot match it
      - password-manager "ignore" hints are added
      - password boxes are masked text inputs, so the browser never
        offers to save or fill them
      - every form is cleared after login, sign-up and logout
  */

  const canMaskText = Boolean(
    window.CSS && typeof CSS.supports === "function" &&
    (CSS.supports("-webkit-text-security", "disc") || CSS.supports("text-security", "disc"))
  );

  function hardenInput(input) {
    const secret = input.classList.contains("secret-input");

    input.setAttribute("autocomplete", secret || input.tagName === "SELECT" ? "off" : "nope");
    input.setAttribute("autocorrect", "off");
    input.setAttribute("spellcheck", "false");
    input.setAttribute("data-lpignore", "true");
    input.setAttribute("data-1p-ignore", "true");
    input.setAttribute("data-bwignore", "true");
    input.setAttribute("data-form-type", "other");
    input.name = `vci_${Math.random().toString(36).slice(2, 10)}`;

    if (secret) {
      if (canMaskText) {
        input.type = "text";
        input.classList.add("text-mask");
      } else {
        input.type = "password";
      }
    }
  }

  function hardenAllInputs() {
    document.querySelectorAll("form").forEach((form) => form.setAttribute("autocomplete", "off"));
    document.querySelectorAll("input, select, textarea").forEach((input) => {
      if (input.type !== "hidden") hardenInput(input);
    });
  }

  function setSecretVisible(input, visible) {
    if (!input) return;

    if (canMaskText) input.classList.toggle("is-revealed", visible);
    else input.type = visible ? "text" : "password";

    const button = document.querySelector(`[data-toggle="${input.id}"]`);
    const icon = button?.querySelector("i");
    if (icon) icon.className = visible ? "fa-solid fa-eye-slash" : "fa-solid fa-eye";
    button?.setAttribute("aria-label", visible ? "Hide password" : "Show password");
  }

  const isSecretVisible = (input) =>
    canMaskText ? input.classList.contains("is-revealed") : input.type === "text";

  function maskSecrets(root = document) {
    root.querySelectorAll(".secret-input").forEach((input) => setSecretVisible(input, false));
  }

  function resetFormFully(form) {
    form.reset();
    form.querySelectorAll("input:not([type=hidden]), textarea").forEach((i) => { i.value = ""; });
    maskSecrets(form);
    clearFieldErrors(form);
  }

  /** Remove everything typed into the login / sign-up form. */
  function clearAuthForm() {
    resetFormFully($("auth-form"));
    $("auth-program").selectedIndex = 0;
    fillYearSelect($("auth-year"), $("auth-program").value);
    updatePasswordMeter();
    $("auth-lock-note").classList.add("hidden");
  }

  /** Remove all personal data from the screen when nobody is logged in. */
  function clearAppView() {
    ["stats-grid", "quick-actions", "recent-grades-body", "grade-summary", "semester-summary-body",
      "insight-body", "home-announcements", "grades-table-body", "grades-summary", "manage-grades-body",
      "students-body", "report-output", "announcement-list", "profile-details"]
      .forEach((id) => { if ($(id)) $(id).replaceChildren(); });

    ["grade-search", "manage-grade-search", "student-search"].forEach((id) => { $(id).value = ""; });
    resetGradeForm();
    resetStudentForm();
    document.querySelectorAll(".page-section").forEach((s) => s.classList.add("hidden"));
  }

  /* ==========================================================
     6. INPUT RULES
     ========================================================== */

  /** "20246348" -> "2024-6348" (digits only, 8 at most). */
  function formatStudentId(raw) {
    const digits = String(raw).replace(/\D/g, "").slice(0, 8);
    return digits.length > 4 ? `${digits.slice(0, 4)}-${digits.slice(4)}` : digits;
  }

  /** Letters are never accepted in a student ID box. */
  function bindStudentIdInput(input, isActive = () => true) {
    let noteTimer = null;

    const flash = () => {
      setFieldError(input, "Letters and symbols are not allowed. Use numbers only (example: 2024-6348).");
      window.clearTimeout(noteTimer);
      noteTimer = window.setTimeout(() => setFieldError(input, ""), 3000);
    };

    input.addEventListener("beforeinput", (event) => {
      if (!isActive()) return;
      if (event.inputType === "insertText" && event.data && /\D/.test(event.data)) {
        event.preventDefault();
        flash();
      }
    });

    input.addEventListener("input", () => {
      if (!isActive()) return;

      const raw = input.value;
      const caret = input.selectionStart ?? raw.length;
      const digitsBefore = raw.slice(0, caret).replace(/\D/g, "").length;
      const formatted = formatStudentId(raw);

      if (/[^\d-]/.test(raw)) flash();
      else setFieldError(input, "");

      if (formatted !== raw) {
        input.value = formatted;
        const position = digitsBefore > 4 ? Math.min(digitsBefore + 1, formatted.length) : digitsBefore;
        input.setSelectionRange(position, position);
      }
    });
  }

  /** Capitalises each word while typing: "bryan elquiero" -> "Bryan Elquiero". */
  function formatNameLive(value) {
    return String(value ?? "")
      .replace(/[^A-Za-zÀ-ÿ\s.'-]/g, "")
      .replace(/^\s+/, "")
      .replace(/\s{2,}/g, " ")
      .toLowerCase()
      .replace(/(^|[\s'-])([a-zà-ÿ])/g, (m, before, letter) => before + letter.toUpperCase());
  }

  const formatName = (value) => formatNameLive(String(value ?? "").trim()).trim();

  function bindNameInput(input) {
    input.addEventListener("input", () => {
      const raw = input.value;
      const caret = input.selectionStart ?? raw.length;
      const formatted = formatNameLive(raw);

      if (formatted !== raw) {
        const position = formatNameLive(raw.slice(0, caret)).length;
        input.value = formatted;
        input.setSelectionRange(position, position);
      }
    });

    input.addEventListener("blur", () => { input.value = formatName(input.value); });
  }

  /** Mobile numbers: digits only, 11 at most. */
  function bindDigitsInput(input, limit) {
    input.addEventListener("input", () => {
      const cleaned = input.value.replace(/\D/g, "").slice(0, limit);
      if (cleaned !== input.value) input.value = cleaned;
    });
  }

  const validName = (name) => NAME_PATTERN.test(name) && name.length >= 5 && name.length <= 60;
  const NAME_MESSAGE = "Enter your first and last name with a space in between (example: Bryan Elquiero).";
  const validEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);

  /* ==========================================================
     7. PROGRAMS AND YEAR LEVELS
     ========================================================== */

  const PROGRAM_GROUPS = [
    {
      label: "College",
      items: [
        ["BSIT", "BSIT - Information Technology"],
        ["BSBA", "BSBA - Financial Management"],
        ["BSA", "BSA (Bachelor of Science in Agriculture)"],
        ["BEEd", "BEEd - Elementary Education"],
        ["BSEd English", "BSEd - English"],
        ["BSEd Filipino", "BSEd - Filipino"],
        ["BSEd Math", "BSEd - Mathematics"],
        ["BSEd Values Education", "BSEd - Values Education"],
        ["BSCrim", "BSCrim - Criminology"]
      ]
    },
    {
      label: "Senior High School",
      items: [
        ["ABM", "ABM"], ["STEM", "STEM"], ["HUMSS", "HUMSS"], ["GAS", "GAS"], ["CSS", "CSS"],
        ["EIM", "EIM"], ["Automotive Servicing", "Automotive Servicing"],
        ["Animal Production", "Animal Production"], ["Organic Agriculture", "Organic Agriculture"]
      ]
    }
  ];

  const SHS_PROGRAMS = new Set(PROGRAM_GROUPS[1].items.map((item) => item[0]));
  const ALL_PROGRAMS = PROGRAM_GROUPS.flatMap((g) => g.items.map((i) => i[0]));

  function fillProgramSelect(select, current, allLabel) {
    select.replaceChildren();

    if (allLabel) {
      const all = document.createElement("option");
      all.value = "all";
      all.textContent = allLabel;
      select.appendChild(all);
    }

    PROGRAM_GROUPS.forEach((group) => {
      const optgroup = document.createElement("optgroup");
      optgroup.label = group.label;

      group.items.forEach(([value, label]) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        optgroup.appendChild(option);
      });

      select.appendChild(optgroup);
    });

    if (current && [...select.options].some((o) => o.value === current)) select.value = current;
  }

  const yearOptions = (program) =>
    SHS_PROGRAMS.has(program)
      ? [["11", "Grade 11"], ["12", "Grade 12"]]
      : [["1", "1st Year"], ["2", "2nd Year"], ["3", "3rd Year"], ["4", "4th Year"]];

  function fillYearSelect(select, program, current) {
    select.replaceChildren(...yearOptions(program).map(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      return option;
    }));

    if (current && [...select.options].some((o) => o.value === current)) select.value = current;
  }

  function yearLabel(program, year) {
    const found = yearOptions(program).find(([value]) => value === String(year));
    return found ? found[1] : year ? `Year ${year}` : "—";
  }

  const programText = (program, year) =>
    `${program || "Program not specified"}${year ? ` · ${yearLabel(program, year)}` : ""}`;

  /* ==========================================================
     8. LOGIN AND REGISTRATION
     ========================================================== */

  function setRole(role) {
    selectedRole = role === ROLE_REG ? ROLE_REG : ROLE_STU;

    document.querySelectorAll(".portal-tab-btn").forEach((button) => {
      button.classList.toggle("active", button.dataset.role === selectedRole);
    });

    if (selectedRole === ROLE_REG && authMode === "register") authMode = "login";

    clearAuthForm();
    updateAuthModeUI();
  }

  function setAuthMode(mode) {
    if (selectedRole === ROLE_REG && mode === "register") {
      showToast("Only student accounts can register.", "error");
      return;
    }

    authMode = mode === "register" ? "register" : "login";
    clearAuthForm();
    updateAuthModeUI();
  }

  function updateAuthModeUI() {
    const register = authMode === "register";
    const student = selectedRole === ROLE_STU;
    const identifier = $("auth-identifier");

    $("login-mode-btn").classList.toggle("active", !register);
    $("register-mode-btn").classList.toggle("active", register);

    $("fullname-group").classList.toggle("hidden", !register);
    $("program-group").classList.toggle("hidden", !register);
    $("year-group").classList.toggle("hidden", !register);
    $("confirm-password-group").classList.toggle("hidden", !register);
    $("pw-strength").classList.toggle("hidden", !register);

    $("identifier-label").textContent = student ? "Student ID" : "Registrar Email";
    $("identifier-icon").className = student ? "fa-solid fa-id-card" : "fa-solid fa-envelope";
    identifier.placeholder = student ? "2024-6348" : "admin@veritas.edu.ph";
    identifier.maxLength = student ? 9 : 80;
    identifier.setAttribute("inputmode", student ? "numeric" : "text");
    $("identifier-hint").textContent = student
      ? "Numbers only, format YYYY-XXXX (example: 2024-6348)."
      : "Enter the registrar e-mail address.";

    $("auth-password").placeholder = register ? "Min. 8 characters" : "Enter your password";

    $("auth-submit-btn").innerHTML = register
      ? '<i class="fa-solid fa-user-plus"></i><span>Create Student Account</span>'
      : '<i class="fa-solid fa-right-to-bracket"></i><span>Login to Portal</span>';

    if (lockSecondsLeft() > 0) startLockCountdown();
    else $("auth-submit-btn").disabled = false;
  }

  function updatePasswordMeter() {
    const value = $("auth-password").value;
    const fill = $("pw-meter-fill");
    const text = $("pw-strength-text");
    const score = passwordStrength(value);

    fill.className = score >= 4 ? "strong" : score >= 3 ? "fair" : "";
    fill.style.width = value ? `${Math.max(12, (score / 5) * 100)}%` : "0";

    text.textContent = !value
      ? `Use ${MIN_PASSWORD}+ characters with letters and numbers.`
      : score >= 4 ? "Strong password" : score >= 3 ? "Fair password - add more characters or symbols" : "Weak password";
  }

  function handleAuthentication(event) {
    event.preventDefault();
    if (authMode === "register") registerStudent();
    else loginUser();
  }

  function registerStudent() {
    const nameInput = $("auth-fullname");
    const idInput = $("auth-identifier");
    const programSelect = $("auth-program");
    const yearSelect = $("auth-year");
    const passwordInput = $("auth-password");
    const confirmInput = $("auth-confirm-password");

    const fullName = formatName(nameInput.value);
    const studentId = idInput.value.trim();
    const program = programSelect.value;
    const year = yearSelect.value;
    const password = passwordInput.value;
    const errors = [];

    if (selectedRole !== ROLE_STU) {
      showToast("Only students can register.", "error");
      return;
    }

    if (!validName(fullName)) errors.push([nameInput, NAME_MESSAGE]);

    if (!STUDENT_ID_PATTERN.test(studentId)) {
      errors.push([idInput, "Student ID must be numbers only in the format YYYY-XXXX (example: 2024-6348)."]);
    } else if (getUserByIdentifier(studentId)) {
      errors.push([idInput, "This Student ID is already registered."]);
    }

    if (!ALL_PROGRAMS.includes(program)) errors.push([programSelect, "Please choose your program."]);
    if (!yearOptions(program).some(([value]) => value === year)) errors.push([yearSelect, "Please choose your year level."]);

    const problem = passwordProblem(password);
    if (problem) errors.push([passwordInput, problem]);
    if (password !== confirmInput.value) errors.push([confirmInput, "The passwords do not match."]);

    if (!applyErrors($("auth-form"), errors)) {
      showToast("Please fix the highlighted fields.", "error");
      return;
    }

    const users = getUsers();
    users.push(createAccount({ fullName, identifier: studentId, role: ROLE_STU, program, year }, password));
    if (!saveUsers(users)) return;

    // Create the student record, or update the one the registrar already made.
    const students = getStudents();
    const existing = students.find((s) => s.studentId === studentId);

    if (existing) {
      Object.assign(existing, { fullName, program, year });
    } else {
      students.push({
        studentId, fullName, program, year, email: "", contact: "", status: "Active",
        createdAt: new Date().toISOString()
      });
    }
    saveStudents(students);

    logAudit("Student registered", `${fullName} (${studentId})`, `${fullName} (${studentId})`);

    // PRIVACY: nothing is kept or pre-filled for the next login.
    
authMode = "login";
clearAuthForm();
updateAuthModeUI();

playPortalSound("register");

showToast("Registration successful. You can now log in.", "success");

  }

  function loginUser() {
    const left = lockSecondsLeft();
    if (left > 0) {
      startLockCountdown();
      showToast(`Login is locked. Try again in ${left} seconds.`, "warning");
      return;
    }

    const idInput = $("auth-identifier");
    const passwordInput = $("auth-password");
    const identifier = idInput.value.trim();
    const password = passwordInput.value;
    const errors = [];

    if (!identifier) errors.push([idInput, selectedRole === ROLE_STU ? "Enter your Student ID." : "Enter the registrar e-mail."]);
    else if (selectedRole === ROLE_STU && !STUDENT_ID_PATTERN.test(identifier)) {
      errors.push([idInput, "Student ID must be numbers only in the format YYYY-XXXX (example: 2024-6348)."]);
    }

    if (!password) errors.push([passwordInput, "Enter your password."]);

    if (!applyErrors($("auth-form"), errors)) return;

    const user = getUserByIdentifier(identifier);

    if (!user || user.role !== selectedRole || !passwordMatches(user, password)) {
      registerFailedLogin(identifier);
      passwordInput.value = "";
      maskSecrets($("auth-form"));
      return;
    }

    clearLock();

    const users = getUsers();
    const stored = users.find((u) => u.id === user.id);
    const previousLogin = stored?.lastLogin || null;
    if (stored) stored.lastLogin = new Date().toISOString();
    saveUsers(users);

    currentUser = {
      id: user.id,
      identifier: user.identifier,
      fullName: user.fullName,
      role: user.role,
      program: user.program || "",
      year: user.year || "",
      previousLogin
    };

    try {
      sessionStorage.setItem(KEYS.session, JSON.stringify(currentUser));
    } catch (error) {
      showToast("Unable to save the current session.", "error");
    }

    logAudit("Login", user.role === ROLE_REG ? "Registrar signed in" : "Student signed in");

    // PRIVACY: clear the form the moment the user is in.
   
 // PRIVACY: clear the form the moment the user is in.
 clearAuthForm();

 // Play a different sound depending on the logged-in role.
 if (currentUser.role === ROLE_REG) {
   playPortalSound("registrar");
 } else {
   playPortalSound("student");
 }

 showApplication();
 showToast(`Welcome, ${currentUser.fullName}!`, "success");

  }

  function restoreSession() {
    try {
      const raw = sessionStorage.getItem(KEYS.session);
      if (!raw) return false;

      const saved = JSON.parse(raw);
      const actual = saved && saved.identifier ? getUserByIdentifier(saved.identifier) : null;

      if (!actual || actual.role !== saved.role) {
        sessionStorage.removeItem(KEYS.session);
        return false;
      }

      currentUser = {
        id: actual.id,
        identifier: actual.identifier,
        fullName: actual.fullName,
        role: actual.role,
        program: actual.program || "",
        year: actual.year || "",
        previousLogin: saved.previousLogin || null
      };

      return true;
    } catch (error) {
      console.error("Could not restore session:", error);
      return false;
    }
  }

  function showApplication() {
    if (!currentUser) return;

    $("auth-screen").classList.add("hidden");
    $("app-container").classList.remove("hidden");

    $("header-user-name").textContent = currentUser.fullName;
    $("header-user-role").textContent = isRegistrar() ? "Registrar" : "Student";
    $("header-avatar").textContent = initials(currentUser.fullName);
    $("welcome-name").textContent = currentUser.fullName.split(" ")[0] || "User";

    $("welcome-sub").textContent = isRegistrar()
      ? "Manage students, encode grades and generate academic reports."
      : currentUser.previousLogin
        ? `Here's an overview of your academic portal. Last login: ${formatDateTime(currentUser.previousLogin)}.`
        : "Here's an overview of your academic portal.";

    document.querySelectorAll(".registrar-only").forEach((el) => el.classList.toggle("hidden", !isRegistrar()));
    $("student-filter-group").classList.toggle("hidden", !isRegistrar());

    resetGradeForm();
    resetStudentForm();
    populateStudentSelects();
    populateReportTypes();
    navigateTo("home");
    lastActivity = Date.now();
  }

  function logoutUser(reason) {
    if (currentUser) logAudit(reason === "idle" ? "Auto logout" : "Logout", reason === "idle" ? "Inactive session" : "");

    currentUser = null;

    try {
      sessionStorage.removeItem(KEYS.session);
    } catch (error) {
      console.error("Could not clear session:", error);
    }

    closeAllModals();
    clearAppView();
    $("app-container").classList.add("hidden");
    $("auth-screen").classList.remove("hidden");
    $("app-nav").classList.remove("open");

    selectedRole = ROLE_STU;
    authMode = "login";
    document.querySelectorAll(".portal-tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.role === ROLE_STU));
    clearAuthForm();
    updateAuthModeUI();
    window.scrollTo(0, 0);

    showToast(
      reason === "idle" ? `You were logged out after ${IDLE_MINUTES} minutes of inactivity.` : "You have been logged out.",
      reason === "idle" ? "warning" : "info"
    );
  }

  /* ==========================================================
     9. NAVIGATION
     ========================================================== */

  const PAGES = ["home", "grades", "manage", "students", "reports", "announcements", "faq", "about"];
  const REGISTRAR_PAGES = ["manage", "students"];

  function navigateTo(page) {
    if (!currentUser) return;
    if (!PAGES.includes(page)) page = "home";

    if (REGISTRAR_PAGES.includes(page) && !isRegistrar()) {
      showToast("Only the registrar can open that page.", "error");
      page = "home";
    }

    currentPage = page;

    document.querySelectorAll(".page-section").forEach((s) => s.classList.add("hidden"));
    $(`page-${page}`).classList.remove("hidden");

    document.querySelectorAll(".nav-link").forEach((button) => {
      const active = button.dataset.page === page;
      button.classList.toggle("active", active);
      if (active) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });

    $("app-nav").classList.remove("open");
    $("mobile-nav-toggle").setAttribute("aria-expanded", "false");
    $("mobile-nav-toggle").innerHTML = '<i class="fa-solid fa-bars"></i>';

    renderPage(page);
    window.scrollTo({ top: 0 });
  }

  function renderPage(page = currentPage) {
    if (!currentUser) return;

    if (page === "home") renderDashboard();
    else if (page === "grades") renderGrades();
    else if (page === "manage") renderManageGrades();
    else if (page === "students") renderStudents();
    else if (page === "reports") renderReport();
    else if (page === "announcements") renderAnnouncements();
  }

  /** Re-draw the page being viewed and refresh the student lists. */
  function refreshAll() {
    populateStudentSelects();
    renderPage();
  }

  /* ==========================================================
     10. GRADE COMPUTATION
     ========================================================== */

  /** Percentage -> equivalent grade. */
  function percentToGrade(percent) {
    for (const [minimum, grade] of GRADE_SCALE) {
      if (percent >= minimum) return grade;
    }
    return 5.0;
  }

  /** Final percentage = 30% Prelim + 30% Midterm + 40% Final exam. */
  function computeFinal(prelim, midterm, final) {
    const percent = Math.round((prelim * WEIGHTS.prelim + midterm * WEIGHTS.midterm + final * WEIGHTS.final) * 100) / 100;
    return { percent, grade: percentToGrade(percent) };
  }

  const getRemarks = (grade) => {
    const n = Number(grade);
    if (!Number.isFinite(n)) return "No grade";
    return n <= PASSING_GRADE ? "Passed" : "Failed";
  };

  const badge = (text, kind) => `<span class="status-badge ${kind}">${escapeHTML(text)}</span>`;
  const remarksBadge = (grade) => badge(getRemarks(grade), getRemarks(grade) === "Passed" ? "passed" : "failed");

  function standingBadge(standing) {
    if (!standing) return badge("—", "neutral");
    if (standing === "Dean's List") return badge(standing, "honors");
    if (standing === "Good Standing") return badge(standing, "passed");
    return badge(standing, "failed");
  }

  /** GWA = sum(grade x units) / sum(units) */
  function summarize(list) {
    let points = 0;
    let units = 0;
    let passed = 0;
    let worst = 0;
    let best = null;
    let bestItem = null;
    const buckets = { excellent: 0, good: 0, fair: 0, failed: 0 };

    list.forEach((item) => {
      points += item.grade * item.units;
      units += item.units;
      worst = Math.max(worst, item.grade);

      if (item.grade <= PASSING_GRADE) passed++;
      if (best === null || item.grade < best) {
        best = item.grade;
        bestItem = item;
      }

      if (item.grade <= 1.75) buckets.excellent++;
      else if (item.grade <= 2.5) buckets.good++;
      else if (item.grade <= PASSING_GRADE) buckets.fair++;
      else buckets.failed++;
    });

    const gwa = units > 0 ? points / units : null;
    const failed = list.length - passed;
    let standing = null;

    if (list.length) {
      if (!failed && gwa <= 1.75 && worst <= 2.5) standing = "Dean's List";
      else if (!failed && gwa <= PASSING_GRADE) standing = "Good Standing";
      else standing = "Needs Improvement";
    }

    return {
      count: list.length, units, gwa, passed, failed, buckets, best, bestItem, standing,
      passRate: list.length ? Math.round((passed / list.length) * 100) : null
    };
  }

  const formatGWA = (value) => (value === null || value === undefined ? "—" : value.toFixed(2));

  const periodLabel = (g) => `${g.semester} ${g.schoolYear}`;

  function periodRank(g) {
    const year = parseInt(g.schoolYear, 10) || 0;
    const sem = { "1st Semester": 1, "2nd Semester": 2, Summer: 3 }[g.semester] || 1;
    return year * 10 + sem;
  }

  /** Unique academic periods, oldest first. */
  function getPeriods(grades) {
    const map = new Map();
    grades.forEach((g) => map.set(periodLabel(g), periodRank(g)));
    return [...map.entries()].sort((a, b) => a[1] - b[1]).map(([label]) => label);
  }

  function groupBy(list, keyFn) {
    const map = new Map();
    list.forEach((item) => {
      const key = keyFn(item);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(item);
    });
    return map;
  }

  /** Grades this account may see (all of them for the registrar). */
  function getScopeGrades() {
    if (!currentUser) return [];
    const all = getGrades();
    if (isRegistrar()) return all;
    return all.filter((g) => g.studentId === currentUser.identifier);
  }

  /** One summary row per student: { student, list, summary } */
  function perStudent(grades) {
    return [...groupBy(grades, (g) => g.studentId).entries()].map(([studentId, list]) => ({
      studentId,
      record: getStudentRecord(studentId),
      name: getStudentName(studentId),
      list,
      summary: summarize(list)
    }));
  }

  /* ==========================================================
     11. DASHBOARD
     ========================================================== */

  function statCard(icon, tone, label, value, note) {
    return `
      <article class="stat-card">
        <div class="stat-icon ${tone}"><i class="fa-solid ${icon}"></i></div>
        <div>
          <p>${escapeHTML(label)}</p>
          <h2>${escapeHTML(value)}</h2>
          <small>${escapeHTML(note)}</small>
        </div>
      </article>`;
  }

  function renderDashboard() {
    const registrar = isRegistrar();
    const grades = getScopeGrades();
    const summary = summarize(grades);
    const students = perStudent(grades);

    // Statistic cards
    if (registrar) {
      const records = getStudents();
      const attention = students.filter((s) => s.summary.standing === "Needs Improvement").length;

      $("stats-grid").innerHTML =
        statCard("fa-users", "green", "Students", records.length, `${records.filter((s) => s.status === "Active").length} active`) +
        statCard("fa-database", "teal", "Grade Records", summary.count, `${summary.units} total units`) +
        statCard("fa-chart-line", "gold", "Class GWA", formatGWA(summary.gwa), "All students, weighted by units") +
        statCard("fa-triangle-exclamation", "red", "Needs Attention", attention, "Failing grade or GWA above 3.00");
    } else {
      $("stats-grid").innerHTML =
        statCard("fa-book", "green", "Total Subjects", summary.count, `${summary.units} total units`) +
        statCard("fa-check-circle", "teal", "Passed Subjects", summary.passed, `${summary.failed} failed`) +
        statCard("fa-chart-line", "gold", "General Average", formatGWA(summary.gwa), "1.00 is the highest grade") +
        statCard("fa-award", "blue", "Academic Standing", summary.standing || "—", summary.bestItem ? `Best: ${summary.bestItem.subjectCode} (${formatGrade(summary.best)})` : "No grades yet");
    }

    // Quick actions
    $("quick-actions").innerHTML = registrar
      ? `<button type="button" class="btn btn-primary" data-page="manage"><i class="fa-solid fa-pen-to-square"></i> Encode Grade</button>
         <button type="button" class="btn btn-outline" data-page="students"><i class="fa-solid fa-user-plus"></i> Add Student</button>
         <button type="button" class="btn btn-outline" data-page="reports"><i class="fa-solid fa-file-lines"></i> Generate Report</button>`
      : `<button type="button" class="btn btn-primary" data-page="grades"><i class="fa-solid fa-book-open"></i> View My Grades</button>
         <button type="button" class="btn btn-outline" data-page="reports"><i class="fa-solid fa-print"></i> My Grade Report</button>`;

    renderRecentGrades(grades, registrar);
    renderDistribution(summary);
    renderSemesterSummary(grades);
    renderInsight(summary, students, registrar);
    renderHomeAnnouncements();
  }

  function renderRecentGrades(grades, registrar) {
    $("recent-title").textContent = registrar ? "Recently Encoded Grades" : "Recent Grades";

    const recent = [...grades].slice(-5).reverse();

    if (!recent.length) {
      $("recent-grades-body").innerHTML =
        '<tr><td colspan="3" class="empty-state">No grades are available yet.</td></tr>';
      return;
    }

    $("recent-grades-body").innerHTML = recent.map((g) => `
      <tr>
        <td>
          <strong>${escapeHTML(g.subjectCode)}</strong>
          <small class="cell-sub">${escapeHTML(g.description)}${registrar ? ` · ${escapeHTML(getStudentName(g.studentId))}` : ""}</small>
        </td>
        <td><strong>${formatGrade(g.grade)}</strong></td>
        <td>${remarksBadge(g.grade)}</td>
      </tr>`).join("");
  }

  function renderDistribution(summary) {
    const total = summary.count;
    const rows = [
      ["Excellent (1.00 - 1.75)", summary.buckets.excellent, ""],
      ["Good (2.00 - 2.50)", summary.buckets.good, "blue"],
      ["Fair (2.75 - 3.00)", summary.buckets.fair, "gold"],
      ["Failed (above 3.00)", summary.buckets.failed, "failed-fill"]
    ];

    $("grade-summary").innerHTML = rows.map(([label, count, tone]) => {
      const percent = total ? Math.round((count / total) * 100) : 0;
      return `
        <div class="summary-row wide">
          <span>${label}</span>
          <div class="summary-track"><div class="summary-fill ${tone}" style="width:${percent}%"></div></div>
          <strong>${count}</strong>
        </div>`;
    }).join("");

    $("summary-note").textContent = total
      ? `${summary.passRate}% passing rate · ${summary.passed} passed, ${summary.failed} failed`
      : "Statistics appear when records are available.";
  }

  function renderSemesterSummary(grades) {
    const groups = groupBy(grades, periodLabel);
    const labels = getPeriods(grades);

    if (!labels.length) {
      $("semester-summary-body").innerHTML = '<tr><td colspan="5" class="empty-state">No academic periods yet.</td></tr>';
      return;
    }

    $("semester-summary-body").innerHTML = labels.map((label) => {
      const s = summarize(groups.get(label));
      return `
        <tr>
          <td><strong>${escapeHTML(label)}</strong></td>
          <td class="num">${s.count}</td>
          <td class="num">${s.units}</td>
          <td class="num"><strong>${formatGWA(s.gwa)}</strong></td>
          <td>${standingBadge(s.standing)}</td>
        </tr>`;
    }).join("");
  }

  function renderInsight(summary, students, registrar) {
    const box = $("insight-body");

    if (!registrar) {
      $("insight-title").textContent = "Academic Standing";

      if (!summary.count) {
        box.innerHTML = '<div class="insight-box"><p class="muted">Your standing will appear once grades are posted.</p></div>';
        return;
      }

      const message = {
        "Dean's List": "Excellent work! Your weighted average qualifies for the Dean's List.",
        "Good Standing": "You are passing all subjects. Keep it up!",
        "Needs Improvement": "One or more grades need attention. Please talk to your adviser or the registrar."
      }[summary.standing];

      box.innerHTML = `
        <div class="insight-box">
          <h3>${standingBadge(summary.standing)}</h3>
          <p>${escapeHTML(message)}</p>
          <ul class="insight-list">
            <li><span>Weighted average (GWA)</span><strong>${formatGWA(summary.gwa)}</strong></li>
            <li><span>Passing rate</span><strong>${summary.passRate}%</strong></li>
            <li><span>Units passed</span><strong>${summary.units - unitsOfFailed(getScopeGrades())} / ${summary.units}</strong></li>
          </ul>
        </div>`;
      return;
    }

    $("insight-title").textContent = "Student Highlights";

    const ranked = students.filter((s) => s.summary.gwa !== null).sort((a, b) => a.summary.gwa - b.summary.gwa);
    const top = ranked.filter((s) => s.summary.standing !== "Needs Improvement").slice(0, 3);
    const attention = ranked.filter((s) => s.summary.standing === "Needs Improvement").reverse().slice(0, 4);

    const list = (items) => items.length
      ? `<ul class="insight-list">${items.map((s) =>
          `<li><span>${escapeHTML(s.name)}</span><strong>${formatGWA(s.summary.gwa)}</strong></li>`).join("")}</ul>`
      : '<p class="muted">No students in this group.</p>';

    box.innerHTML = `
      <div class="insight-box">
        <h3>Top performers</h3>${list(top)}
        <h3 style="margin-top:18px">Needs attention</h3>${list(attention)}
      </div>`;
  }

  const unitsOfFailed = (grades) => grades.filter((g) => g.grade > PASSING_GRADE).reduce((sum, g) => sum + g.units, 0);

  /* ==========================================================
     12. VIEW GRADES
     ========================================================== */

  function populateStudentSelects() {
    const students = getStudents().sort((a, b) => byText(a.fullName, b.fullName));
    const option = (s) => `<option value="${escapeHTML(s.studentId)}">${escapeHTML(s.fullName)} (${escapeHTML(s.studentId)})</option>`;

    const keep = (select, html) => {
      const previous = select.value;
      select.innerHTML = html;
      if ([...select.options].some((o) => o.value === previous)) select.value = previous;
    };

    keep($("student-filter"), '<option value="all">All Students</option>' + students.map(option).join(""));
    keep($("grade-student-id"), '<option value="">Select a student</option>' + students.map(option).join(""));
    keep($("report-student"), students.map(option).join(""));
  }

  function fillFilter(select, values, allLabel) {
    const previous = select.value;
    select.innerHTML = `<option value="all">${allLabel}</option>` +
      values.map((v) => `<option value="${escapeHTML(v)}">${escapeHTML(v)}</option>`).join("");
    select.value = values.includes(previous) ? previous : "all";
  }

  const GRADE_SORTERS = {
    period: (a, b) => periodRank(a) - periodRank(b) || byText(a.subjectCode, b.subjectCode),
    code: (a, b) => byText(a.subjectCode, b.subjectCode) || periodRank(a) - periodRank(b),
    "grade-asc": (a, b) => a.grade - b.grade || byText(a.subjectCode, b.subjectCode),
    "grade-desc": (a, b) => b.grade - a.grade || byText(a.subjectCode, b.subjectCode)
  };

  /** Grades after the search, semester, school year and student filters. */
  function getFilteredGrades() {
    const search = norm($("grade-search").value);
    const semester = $("semester-filter").value;
    const year = $("school-year-filter").value;
    const student = $("student-filter").value;

    return getScopeGrades()
      .filter((g) => {
        if (isRegistrar() && student !== "all" && g.studentId !== student) return false;
        if (semester !== "all" && g.semester !== semester) return false;
        if (year !== "all" && g.schoolYear !== year) return false;

        return !search || norm(
          [g.subjectCode, g.description, g.schoolYear, isRegistrar() ? getStudentName(g.studentId) : ""].join(" ")
        ).includes(search);
      })
      .sort(GRADE_SORTERS[$("grade-sort").value] || GRADE_SORTERS.period);
  }

  function renderGrades() {
    if (!currentUser) return;

    const registrar = isRegistrar();
    fillFilter($("school-year-filter"), [...new Set(getScopeGrades().map((g) => g.schoolYear))].sort(), "All School Years");

    const grades = getFilteredGrades();
    const selectedStudent = $("student-filter").value;
    const record = registrar ? (selectedStudent !== "all" ? getStudentRecord(selectedStudent) : null) : getStudentRecord(currentUser.identifier);

    $("report-student-name").textContent = registrar
      ? (record ? record.fullName : "All students")
      : currentUser.fullName;

    $("report-program").textContent = registrar
      ? (record ? programText(record.program, record.year) : "Registrar View")
      : programText(currentUser.program, currentUser.year);

    $("grades-table-body").innerHTML = grades.length
      ? grades.map((g) => {
          const detail = g.finalPercent !== null
            ? `<small class="cell-sub">${formatPercent(g.finalPercent)} (P ${g.prelim} · M ${g.midterm} · F ${g.final})</small>`
            : "";

          return `
            <tr>
              <td>${escapeHTML(g.subjectCode)}</td>
              <td>
                <strong>${escapeHTML(g.description)}</strong>
                ${registrar ? `<small class="cell-sub">${escapeHTML(getStudentName(g.studentId))} (${escapeHTML(g.studentId)})</small>` : ""}
              </td>
              <td class="num">${escapeHTML(g.units)}</td>
              <td class="num"><strong>${formatGrade(g.grade)}</strong>${detail}</td>
              <td>${escapeHTML(periodLabel(g))}</td>
              <td>${remarksBadge(g.grade)}</td>
            </tr>`;
        }).join("")
      : '<tr><td colspan="6" class="empty-state">No results found. No grade records match your search or filters.</td></tr>';

    const s = summarize(grades);
    $("grades-summary").innerHTML = grades.length
      ? `<span><strong>${s.count}</strong> subject${s.count === 1 ? "" : "s"}</span>
         <span>Total units: <strong>${s.units}</strong></span>
         <span>Weighted GWA: <strong>${formatGWA(s.gwa)}</strong></span>
         <span>Passing rate: <strong>${s.passRate}%</strong></span>`
      : "";

    $("grade-result-count").textContent = `${grades.length} record${grades.length === 1 ? "" : "s"}`;

    $("grades-print-header").innerHTML = `
      <h2>Veritas College of Irosin - Grade Report</h2>
      <p>${escapeHTML($("report-student-name").textContent)} · ${escapeHTML($("report-program").textContent)}</p>
      <p>Printed ${escapeHTML(formatDate(new Date().toISOString()))}</p>`;
  }

  function exportGradesCsv() {
    const grades = getFilteredGrades();
    if (!grades.length) return showToast("There are no records to export.", "warning");

    downloadCsv(`Veritas_Grades_${isRegistrar() ? "All" : currentUser.identifier}.csv`, [
      ["Student", "Student ID", "Subject Code", "Description", "Units", "Prelim", "Midterm", "Final Exam", "Final %", "Grade", "Remarks", "Semester", "School Year"],
      ...grades.map((g) => [
        getStudentName(g.studentId), g.studentId, g.subjectCode, g.description, g.units,
        g.prelim ?? "", g.midterm ?? "", g.final ?? "", g.finalPercent ?? "",
        formatGrade(g.grade), getRemarks(g.grade), g.semester, g.schoolYear
      ])
    ]);
  }

  /* ==========================================================
     13. GRADE ENCODING (REGISTRAR)
     ========================================================== */

  function requireRegistrar() {
    if (isRegistrar()) return true;
    showToast("You are not authorized to do that.", "error");
    return false;
  }

  const currentMethod = () => $("grade-method").value;

  function updateMethodUI() {
    const direct = currentMethod() === "direct";
    $("score-fields").classList.toggle("hidden", direct);
    $("direct-grade-field").classList.toggle("hidden", !direct);
    updateGradePreview();
  }

  /** Reads the three scores. Returns null when any is missing or out of range. */
  function readScores() {
    const values = ["grade-prelim", "grade-midterm", "grade-final"].map((id) => $(id).value.trim());
    if (values.some((v) => v === "")) return null;

    const numbers = values.map(Number);
    if (numbers.some((n) => !Number.isFinite(n) || n < 0 || n > 100)) return null;

    return numbers;
  }

  function updateGradePreview() {
    const box = $("grade-preview");

    if (currentMethod() === "direct") {
      const value = Number($("grade-value").value);
      const ok = $("grade-value").value !== "" && value >= 1 && value <= 5;

      box.className = `grade-preview${ok ? "" : " is-empty"}`;
      box.innerHTML = ok
        ? `<span>Final grade: <strong>${formatGrade(value)}</strong></span><span>${remarksBadge(value)}</span>`
        : "Enter the final grade (1.00 to 5.00).";
      return;
    }

    const scores = readScores();

    if (!scores) {
      box.className = "grade-preview is-empty";
      box.textContent = "Enter the Prelim, Midterm and Final scores (0 - 100) to see the computed final grade.";
      return;
    }

    const result = computeFinal(...scores);
    box.className = "grade-preview";
    box.innerHTML = `
      <span>Final percentage: <strong>${formatPercent(result.percent)}</strong></span>
      <span>Equivalent grade: <strong>${formatGrade(result.grade)}</strong></span>
      <span>${remarksBadge(result.grade)}</span>`;
  }

  function resetGradeForm() {
    resetFormFully($("grade-form"));
    $("grade-record-id").value = "";
    $("grade-units").value = "3";
    $("grade-school-year").value = "2025-2026";
    $("grade-method").value = "scores";
    $("grade-form-title").textContent = "Add Grade Record";
    $("grade-save-label").textContent = "Save Grade";
    updateMethodUI();
  }

  function handleGradeSubmit(event) {
    event.preventDefault();
    if (!requireRegistrar()) return;

    const form = $("grade-form");
    const recordId = $("grade-record-id").value;
    const studentInput = $("grade-student-id");
    const codeInput = $("grade-subject-code");
    const descInput = $("grade-description");
    const unitsInput = $("grade-units");
    const yearInput = $("grade-school-year");

    const studentId = studentInput.value;
    const subjectCode = codeInput.value.trim().toUpperCase().replace(/\s+/g, " ");
    const description = descInput.value.trim().replace(/\s+/g, " ");
    const units = Number(unitsInput.value);
    const semester = $("grade-semester").value;
    const schoolYear = yearInput.value.trim();
    const direct = currentMethod() === "direct";
    const errors = [];

    if (!studentId || !getStudentRecord(studentId)) errors.push([studentInput, "Choose a student from the list."]);
    if (!subjectCode) errors.push([codeInput, "Enter the subject code."]);
    if (!description) errors.push([descInput, "Enter the subject description."]);

    if (unitsInput.value.trim() === "" || !Number.isInteger(units) || units < 1 || units > 12) {
      errors.push([unitsInput, "Units must be a whole number from 1 to 12."]);
    }

    const yearMatch = schoolYear.match(/^(\d{4})-(\d{4})$/);
    if (!yearMatch || Number(yearMatch[2]) !== Number(yearMatch[1]) + 1) {
      errors.push([yearInput, "Use the format 2025-2026."]);
    }

    let grade;
    let prelim = null;
    let midterm = null;
    let final = null;
    let finalPercent = null;

    if (direct) {
      const input = $("grade-value");
      grade = Number(input.value);

      if (input.value.trim() === "" || !Number.isFinite(grade) || grade < 1 || grade > 5) {
        errors.push([input, "Grade must be between 1.00 and 5.00."]);
      } else if (Math.round(grade * 4) !== grade * 4) {
        errors.push([input, "Use steps of 0.25 (for example 1.75)."]);
      }
    } else {
      const ids = ["grade-prelim", "grade-midterm", "grade-final"];
      const inputs = ids.map($);
      const numbers = inputs.map((i) => Number(i.value));

      inputs.forEach((input, index) => {
        if (input.value.trim() === "" || !Number.isFinite(numbers[index]) || numbers[index] < 0 || numbers[index] > 100) {
          errors.push([input, "Enter a score from 0 to 100."]);
        }
      });

      if (!errors.some(([input]) => inputs.includes(input))) {
        [prelim, midterm, final] = numbers;
        const result = computeFinal(prelim, midterm, final);
        finalPercent = result.percent;
        grade = result.grade;
      }
    }

    const grades = getGrades();

    if (studentId && subjectCode && yearMatch) {
      const duplicate = grades.some((g) =>
        g.id !== recordId && g.studentId === studentId && norm(g.subjectCode) === norm(subjectCode) &&
        g.semester === semester && g.schoolYear === schoolYear);

      if (duplicate) errors.push([codeInput, "This student already has a grade for this subject in that period."]);
    }

    if (!applyErrors(form, errors)) {
      showToast("Please fix the highlighted fields.", "error");
      return;
    }

    const student = getStudentRecord(studentId);
    const record = {
      id: recordId || generateId("grade"),
      studentId,
      studentName: student.fullName,
      program: student.program,
      year: student.year,
      subjectCode, description, units, grade, semester, schoolYear,
      prelim, midterm, final, finalPercent
    };

    if (recordId) {
      const index = grades.findIndex((g) => g.id === recordId);
      if (index === -1) return showToast("The record could not be found.", "error");
      grades[index] = record;
    } else {
      grades.push(record);
    }

    if (!saveGrades(grades)) return;

    logAudit(recordId ? "Grade updated" : "Grade encoded",
      `${student.fullName} - ${subjectCode} = ${formatGrade(grade)}${finalPercent !== null ? ` (${formatPercent(finalPercent)})` : ""}`);

    resetGradeForm();
    refreshAll();
    showToast(
      `${recordId ? "Grade record updated" : "Grade record added"}${finalPercent !== null ? ` - final grade ${formatGrade(grade)}` : ""}.`,
      "success"
    );
  }

  function getManageGrades() {
    const search = norm($("manage-grade-search").value);
    const period = $("manage-semester-filter").value;

    return getGrades()
      .filter((g) => {
        if (period !== "all" && periodLabel(g) !== period) return false;
        return !search || norm([getStudentName(g.studentId), g.studentId, g.subjectCode, g.description].join(" ")).includes(search);
      })
      .sort((a, b) => byText(getStudentName(a.studentId), getStudentName(b.studentId)) || periodRank(a) - periodRank(b) || byText(a.subjectCode, b.subjectCode));
  }

  function renderManageGrades() {
    if (!isRegistrar()) return;

    fillFilter($("manage-semester-filter"), getPeriods(getGrades()), "All periods");
    const grades = getManageGrades();

    $("manage-grades-body").innerHTML = grades.length
      ? grades.map((g) => `
          <tr>
            <td>
              <strong>${escapeHTML(getStudentName(g.studentId))}</strong>
              <small class="cell-sub">${escapeHTML(g.studentId)}</small>
            </td>
            <td>
              <strong>${escapeHTML(g.subjectCode)}</strong>
              <small class="cell-sub">${escapeHTML(g.description)}</small>
            </td>
            <td class="num">${escapeHTML(g.units)}</td>
            <td class="num">${g.finalPercent !== null ? formatPercent(g.finalPercent) : "—"}</td>
            <td class="num"><strong>${formatGrade(g.grade)}</strong> ${remarksBadge(g.grade)}</td>
            <td>${escapeHTML(periodLabel(g))}</td>
            <td>
              <div class="table-actions">
                <button type="button" class="btn btn-outline btn-small" data-action="edit-grade" data-id="${escapeHTML(g.id)}">
                  <i class="fa-solid fa-pen"></i> Edit
                </button>
                <button type="button" class="btn btn-danger btn-small" data-action="delete-grade" data-id="${escapeHTML(g.id)}">
                  <i class="fa-solid fa-trash"></i> Delete
                </button>
              </div>
            </td>
          </tr>`).join("")
      : '<tr><td colspan="7" class="empty-state">No results found.</td></tr>';

    const s = summarize(grades);
    $("manage-summary").innerHTML = grades.length
      ? `<span><strong>${grades.length}</strong> record${grades.length === 1 ? "" : "s"}</span>
         <span>Average GWA: <strong>${formatGWA(s.gwa)}</strong></span>
         <span>Failed: <strong>${s.failed}</strong></span>`
      : "";
  }

  function editGrade(recordId) {
    if (!requireRegistrar()) return;

    const record = getGrades().find((g) => g.id === recordId);
    if (!record) return showToast("Grade record not found.", "error");

    populateStudentSelects();
    clearFieldErrors($("grade-form"));

    $("grade-record-id").value = record.id;
    $("grade-student-id").value = record.studentId;
    $("grade-subject-code").value = record.subjectCode;
    $("grade-description").value = record.description;
    $("grade-units").value = record.units;
    $("grade-semester").value = record.semester;
    $("grade-school-year").value = record.schoolYear;

    const hasScores = record.prelim !== null && record.midterm !== null && record.final !== null;
    $("grade-method").value = hasScores ? "scores" : "direct";
    $("grade-prelim").value = record.prelim ?? "";
    $("grade-midterm").value = record.midterm ?? "";
    $("grade-final").value = record.final ?? "";
    $("grade-value").value = record.grade;

    $("grade-form-title").textContent = "Edit Grade Record";
    $("grade-save-label").textContent = "Update Grade";
    updateMethodUI();

    $("grade-form").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function deleteGrade(recordId) {
    if (!requireRegistrar()) return;

    const record = getGrades().find((g) => g.id === recordId);
    if (!record) return showToast("Grade record not found.", "error");

    const ok = await askConfirm({
      title: "Delete this grade record?",
      message: `${getStudentName(record.studentId)} - ${record.subjectCode} ${record.description} (${periodLabel(record)}, grade ${formatGrade(record.grade)}). This cannot be undone.`
    });

    if (!ok) return;
    if (!saveGrades(getGrades().filter((g) => g.id !== recordId))) return;

    logAudit("Grade deleted", `${getStudentName(record.studentId)} - ${record.subjectCode}`);
    resetGradeForm();
    refreshAll();
    showToast("Grade record deleted.", "success");
  }

  function exportManageCsv() {
    const grades = getManageGrades();
    if (!grades.length) return showToast("There are no records to export.", "warning");

    downloadCsv("Veritas_Grade_Records.csv", [
      ["Student", "Student ID", "Subject Code", "Description", "Units", "Prelim", "Midterm", "Final Exam", "Final %", "Grade", "Remarks", "Period"],
      ...grades.map((g) => [
        getStudentName(g.studentId), g.studentId, g.subjectCode, g.description, g.units,
        g.prelim ?? "", g.midterm ?? "", g.final ?? "", g.finalPercent ?? "",
        formatGrade(g.grade), getRemarks(g.grade), periodLabel(g)
      ])
    ]);
  }

  /* ==========================================================
     14. STUDENT INFORMATION MANAGEMENT (REGISTRAR)
     ========================================================== */

  function resetStudentForm() {
    resetFormFully($("student-form"));
    $("student-record-id").value = "";
    $("stu-id").readOnly = false;
    $("stu-program").selectedIndex = 0;
    fillYearSelect($("stu-year"), $("stu-program").value);
    $("stu-status").value = "Active";
    $("student-form-title").textContent = "Add Student";
    $("student-save-label").textContent = "Save Student";
  }

  function handleStudentSubmit(event) {
    event.preventDefault();
    if (!requireRegistrar()) return;

    const form = $("student-form");
    const originalId = $("student-record-id").value;
    const idInput = $("stu-id");
    const nameInput = $("stu-name");
    const emailInput = $("stu-email");
    const contactInput = $("stu-contact");

    const studentId = idInput.value.trim();
    const fullName = formatName(nameInput.value);
    const program = $("stu-program").value;
    const year = $("stu-year").value;
    const email = emailInput.value.trim();
    const contact = contactInput.value.trim();
    const status = $("stu-status").value;
    const errors = [];

    const students = getStudents();

    if (!STUDENT_ID_PATTERN.test(studentId)) {
      errors.push([idInput, "Student ID must be numbers only in the format YYYY-XXXX."]);
    } else if (!originalId && students.some((s) => s.studentId === studentId)) {
      errors.push([idInput, "This Student ID already exists."]);
    }

    if (!validName(fullName)) errors.push([nameInput, NAME_MESSAGE]);
    if (!ALL_PROGRAMS.includes(program)) errors.push([$("stu-program"), "Choose a program."]);
    if (!yearOptions(program).some(([v]) => v === year)) errors.push([$("stu-year"), "Choose a year level."]);
    if (email && !validEmail(email)) errors.push([emailInput, "Enter a valid e-mail address."]);
    if (contact && !/^09\d{9}$/.test(contact)) errors.push([contactInput, "Use an 11-digit mobile number starting with 09."]);

    if (!applyErrors(form, errors)) {
      showToast("Please fix the highlighted fields.", "error");
      return;
    }

    if (originalId) {
      const record = students.find((s) => s.studentId === originalId);
      if (!record) return showToast("Student record not found.", "error");

      Object.assign(record, { fullName, program, year, email, contact, status });

      // Keep the login account in step with the student record.
      const users = getUsers();
      const account = users.find((u) => u.role === ROLE_STU && u.identifier === originalId);
      if (account) {
        Object.assign(account, { fullName, program, year });
        saveUsers(users);
      }

      logAudit("Student updated", `${fullName} (${originalId})`);
    } else {
      students.push({ studentId, fullName, program, year, email, contact, status, createdAt: new Date().toISOString() });
      logAudit("Student added", `${fullName} (${studentId})`);
    }

    if (!saveStudents(students)) return;

    showToast(originalId ? "Student record updated." : "Student added.", "success");
    resetStudentForm();
    refreshAll();
  }

  function getFilteredStudents() {
    const search = norm($("student-search").value);
    const program = $("student-program-filter").value;

    return getStudents()
      .filter((s) => (program === "all" || s.program === program) &&
        (!search || norm(`${s.fullName} ${s.studentId}`).includes(search)))
      .sort((a, b) => byText(a.fullName, b.fullName));
  }

  function renderStudents() {
    if (!isRegistrar()) return;

    const programs = [...new Set(getStudents().map((s) => s.program))].sort();
    fillFilter($("student-program-filter"), programs, "All Programs");

    const students = getFilteredStudents();
    const accounts = new Set(getUsers().filter((u) => u.role === ROLE_STU).map((u) => u.identifier));

    $("students-body").innerHTML = students.length
      ? students.map((s) => `
          <tr>
            <td>
              <strong>${escapeHTML(s.fullName)}</strong>
              <small class="cell-sub">${escapeHTML(s.studentId)}${s.email ? ` · ${escapeHTML(s.email)}` : ""}${s.contact ? ` · ${escapeHTML(s.contact)}` : ""}</small>
            </td>
            <td>${escapeHTML(s.program)}</td>
            <td>${escapeHTML(yearLabel(s.program, s.year))}</td>
            <td>${badge(s.status || "Active", s.status === "Inactive" ? "pending" : s.status === "Graduated" ? "honors" : "passed")}</td>
            <td>${accounts.has(s.studentId) ? badge("Registered", "passed") : badge("No account yet", "neutral")}</td>
            <td>
              <div class="table-actions">
                <button type="button" class="btn btn-outline btn-small" data-action="edit-student" data-id="${escapeHTML(s.studentId)}">
                  <i class="fa-solid fa-pen"></i> Edit
                </button>
                <button type="button" class="btn btn-outline btn-small" data-action="student-grades" data-id="${escapeHTML(s.studentId)}">
                  <i class="fa-solid fa-book-open"></i> Grades
                </button>
                <button type="button" class="btn btn-danger btn-small" data-action="delete-student" data-id="${escapeHTML(s.studentId)}">
                  <i class="fa-solid fa-trash"></i> Delete
                </button>
              </div>
            </td>
          </tr>`).join("")
      : '<tr><td colspan="6" class="empty-state">No results found.</td></tr>';

    const all = getStudents();
    $("students-summary").innerHTML =
      `<span><strong>${students.length}</strong> of ${all.length} student${all.length === 1 ? "" : "s"}</span>` +
      `<span>Active: <strong>${all.filter((s) => s.status === "Active").length}</strong></span>` +
      `<span>With login account: <strong>${all.filter((s) => accounts.has(s.studentId)).length}</strong></span>`;
  }

  function editStudent(studentId) {
    if (!requireRegistrar()) return;

    const record = getStudentRecord(studentId);
    if (!record) return showToast("Student record not found.", "error");

    clearFieldErrors($("student-form"));

    $("student-record-id").value = record.studentId;
    $("stu-id").value = record.studentId;
    $("stu-id").readOnly = true;
    $("stu-name").value = record.fullName;
    $("stu-program").value = record.program;
    fillYearSelect($("stu-year"), record.program, record.year);
    $("stu-email").value = record.email || "";
    $("stu-contact").value = record.contact || "";
    $("stu-status").value = record.status || "Active";

    $("student-form-title").textContent = "Edit Student";
    $("student-save-label").textContent = "Update Student";
    $("student-form").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function deleteStudent(studentId) {
    if (!requireRegistrar()) return;

    const record = getStudentRecord(studentId);
    if (!record) return showToast("Student record not found.", "error");

    const gradeCount = getGrades().filter((g) => g.studentId === studentId).length;

    const ok = await askConfirm({
      title: "Delete this student?",
      message: `${record.fullName} (${studentId}) will be removed together with ${gradeCount} grade record${gradeCount === 1 ? "" : "s"} and the login account, if any. This cannot be undone.`
    });

    if (!ok) return;

    saveStudents(getStudents().filter((s) => s.studentId !== studentId));
    saveGrades(getGrades().filter((g) => g.studentId !== studentId));
    saveUsers(getUsers().filter((u) => !(u.role === ROLE_STU && u.identifier === studentId)));

    logAudit("Student deleted", `${record.fullName} (${studentId}), ${gradeCount} grade record(s)`);
    resetStudentForm();
    refreshAll();
    showToast("Student deleted.", "success");
  }

  function exportStudentsCsv() {
    const students = getFilteredStudents();
    if (!students.length) return showToast("There are no records to export.", "warning");

    downloadCsv("Veritas_Students.csv", [
      ["Student ID", "Full Name", "Program", "Year Level", "E-mail", "Mobile", "Status"],
      ...students.map((s) => [s.studentId, s.fullName, s.program, yearLabel(s.program, s.year), s.email, s.contact, s.status])
    ]);
  }

  /* ==========================================================
     15. REPORTS
     ========================================================== */

  let currentReport = null;

  function populateReportTypes() {
    const types = isRegistrar()
      ? [["student", "Student Grade Report"], ["subject", "Subject Performance Report"],
         ["honors", "Dean's List & Needs Attention"], ["program", "Program Summary"], ["audit", "Activity Log"]]
      : [["student", "My Grade Report"]];

    $("report-type").innerHTML = types.map(([v, l]) => `<option value="${v}">${l}</option>`).join("");
  }

  const cell = (html, csv) => ({ html, csv });
  const textCell = (value) => cell(escapeHTML(value), String(value ?? ""));

  function buildStudentReport(period) {
    const registrar = isRegistrar();
    const studentId = registrar ? $("report-student").value : currentUser.identifier;
    const record = getStudentRecord(studentId);

    let list = getGrades().filter((g) => g.studentId === studentId);
    if (period !== "all") list = list.filter((g) => periodLabel(g) === period);
    list.sort((a, b) => periodRank(a) - periodRank(b) || byText(a.subjectCode, b.subjectCode));

    const all = summarize(list);
    const name = record ? record.fullName : studentId || "—";

    const chips = [["Subjects", all.count], ["Total units", all.units], ["Weighted GWA", formatGWA(all.gwa)], ["Standing", all.standing || "—"]];

    // GWA of each academic period
    const groups = groupBy(list, periodLabel);
    getPeriods(list).forEach((label) => chips.push([label, formatGWA(summarize(groups.get(label)).gwa)]));

    return {
      title: "Student Grade Report",
      subtitle: `${name} · ID ${studentId || "—"} · ${record ? programText(record.program, record.year) : "—"}`,
      chips,
      head: ["Period", "Code", "Description", "Units", "Final %", "Grade", "Remarks"],
      numeric: [3, 4, 5],
      rows: list.map((g) => [
        textCell(periodLabel(g)), textCell(g.subjectCode), textCell(g.description), textCell(g.units),
        textCell(g.finalPercent !== null ? formatPercent(g.finalPercent) : "—"),
        cell(`<strong>${formatGrade(g.grade)}</strong>`, formatGrade(g.grade)),
        cell(remarksBadge(g.grade), getRemarks(g.grade))
      ]),
      filename: `Veritas_Grade_Report_${studentId}.csv`,
      signatures: ["Prepared by", "Registrar"]
    };
  }

  function buildSubjectReport(period) {
    let list = getGrades();
    if (period !== "all") list = list.filter((g) => periodLabel(g) === period);

    const groups = groupBy(list, (g) => g.subjectCode);
    const rows = [...groups.entries()].sort((a, b) => byText(a[0], b[0])).map(([code, items]) => {
      const s = summarize(items);
      const worst = Math.max(...items.map((g) => g.grade));
      return [
        textCell(code), textCell(items[0].description), textCell(items.length),
        textCell(formatGWA(s.gwa)), textCell(formatGrade(s.best)), textCell(formatGrade(worst)),
        textCell(s.passed), textCell(s.failed), textCell(`${s.passRate}%`)
      ];
    });

    const all = summarize(list);

    return {
      title: "Subject Performance Report",
      subtitle: period === "all" ? "All academic periods" : period,
      chips: [["Subjects", groups.size], ["Grade records", all.count], ["Overall average", formatGWA(all.gwa)], ["Passing rate", all.passRate === null ? "—" : `${all.passRate}%`]],
      head: ["Code", "Description", "Students", "Avg grade", "Best", "Lowest", "Passed", "Failed", "Pass rate"],
      numeric: [2, 3, 4, 5, 6, 7, 8],
      rows,
      filename: "Veritas_Subject_Performance.csv",
      signatures: ["Prepared by", "Registrar"]
    };
  }

  function buildHonorsReport(period) {
    let list = getGrades();
    if (period !== "all") list = list.filter((g) => periodLabel(g) === period);

    const students = perStudent(list).filter((s) => s.summary.gwa !== null).sort((a, b) => a.summary.gwa - b.summary.gwa);
    const honors = students.filter((s) => s.summary.standing === "Dean's List").length;
    const attention = students.filter((s) => s.summary.standing === "Needs Improvement").length;

    return {
      title: "Dean's List & Needs Attention",
      subtitle: period === "all" ? "All academic periods (cumulative)" : period,
      chips: [["Students ranked", students.length], ["Dean's List", honors], ["Needs improvement", attention]],
      head: ["Rank", "Student", "Student ID", "Program", "Units", "GWA", "Standing"],
      numeric: [0, 4, 5],
      rows: students.map((s, index) => [
        textCell(index + 1), textCell(s.name), textCell(s.studentId),
        textCell(s.record ? programText(s.record.program, s.record.year) : "—"),
        textCell(s.summary.units),
        cell(`<strong>${formatGWA(s.summary.gwa)}</strong>`, formatGWA(s.summary.gwa)),
        cell(standingBadge(s.summary.standing), s.summary.standing)
      ]),
      filename: "Veritas_Deans_List.csv",
      signatures: ["Prepared by", "Registrar", "Noted by"]
    };
  }

  function buildProgramReport(period) {
    let list = getGrades();
    if (period !== "all") list = list.filter((g) => periodLabel(g) === period);

    const groups = groupBy(list, (g) => getStudentRecord(g.studentId)?.program || g.program || "Unassigned");
    const rows = [...groups.entries()].sort((a, b) => byText(a[0], b[0])).map(([program, items]) => {
      const s = summarize(items);
      return [
        textCell(program), textCell(new Set(items.map((g) => g.studentId)).size), textCell(s.count),
        textCell(formatGWA(s.gwa)), textCell(s.passed), textCell(s.failed), textCell(`${s.passRate}%`)
      ];
    });

    const all = summarize(list);

    return {
      title: "Program Summary",
      subtitle: period === "all" ? "All academic periods" : period,
      chips: [["Programs", groups.size], ["Students", new Set(list.map((g) => g.studentId)).size], ["Overall GWA", formatGWA(all.gwa)]],
      head: ["Program", "Students", "Grade records", "Average GWA", "Passed", "Failed", "Pass rate"],
      numeric: [1, 2, 3, 4, 5],
      rows,
      filename: "Veritas_Program_Summary.csv",
      signatures: ["Prepared by", "Registrar"]
    };
  }

  function buildAuditReport() {
    const log = readArray(KEYS.audit);

    return {
      title: "Activity Log",
      subtitle: "Most recent 150 security and record activities",
      chips: [["Entries", log.length], ["Failed logins", log.filter((e) => e.action === "Login failed").length]],
      head: ["Time", "User", "Action", "Details"],
      numeric: [],
      rows: log.map((e) => [textCell(formatDateTime(e.time)), textCell(e.actor), textCell(e.action), textCell(e.detail)]),
      filename: "Veritas_Activity_Log.csv",
      signatures: ["Reviewed by"]
    };
  }

  function renderReport() {
    if (!currentUser) return;

    const type = $("report-type").value || "student";
    const registrar = isRegistrar();

    $("report-student-group").classList.toggle("hidden", !(registrar && type === "student"));
    $("report-period-group").classList.toggle("hidden", type === "audit");

    // Academic periods available for the selected report
    const periodSource = type === "student"
      ? getGrades().filter((g) => g.studentId === (registrar ? $("report-student").value : currentUser.identifier))
      : getGrades();
    fillFilter($("report-period"), getPeriods(periodSource), "All periods");

    const period = $("report-period").value;

    currentReport =
      type === "subject" ? buildSubjectReport(period)
      : type === "honors" ? buildHonorsReport(period)
      : type === "program" ? buildProgramReport(period)
      : type === "audit" ? buildAuditReport()
      : buildStudentReport(period);

    const r = currentReport;

    $("report-output").innerHTML = `
      <div class="report-head">
        <p class="eyebrow">VERITAS COLLEGE OF IROSIN</p>
        <h2>${escapeHTML(r.title)}</h2>
        <p>${escapeHTML(r.subtitle)}</p>
        <p>Generated ${escapeHTML(formatDateTime(new Date().toISOString()))} by ${escapeHTML(currentUser.fullName)}</p>
      </div>

      <div class="report-chips">
        ${r.chips.map(([label, value]) => `<div class="report-chip">${escapeHTML(label)}<strong>${escapeHTML(value)}</strong></div>`).join("")}
      </div>

      <div class="table-responsive">
        <table>
          <thead><tr>${r.head.map((h, i) => `<th class="${r.numeric.includes(i) ? "num" : ""}">${escapeHTML(h)}</th>`).join("")}</tr></thead>
          <tbody>
            ${r.rows.length
              ? r.rows.map((row) => `<tr>${row.map((c, i) => `<td class="${r.numeric.includes(i) ? "num" : ""}">${c.html}</td>`).join("")}</tr>`).join("")
              : `<tr><td colspan="${r.head.length}" class="empty-state">No records found for this report.</td></tr>`}
          </tbody>
        </table>
      </div>

      <div class="signature-row">${r.signatures.map((s) => `<div>${escapeHTML(s)}</div>`).join("")}</div>`;
  }

  function exportReportCsv() {
    if (!currentReport || !currentReport.rows.length) return showToast("There is nothing to export for this report.", "warning");

    logAudit("Report exported", currentReport.title);
    downloadCsv(currentReport.filename, [currentReport.head, ...currentReport.rows.map((row) => row.map((c) => c.csv))]);
  }

  function printReport() {
    if (!currentReport) renderReport();
    logAudit("Report printed", currentReport?.title || "");
    window.print();
  }

  /* ==========================================================
     16. ANNOUNCEMENTS
     ========================================================== */

  function announcementMarkup(item, index, canDelete) {
    const icons = ["fa-bullhorn", "fa-calendar-check", "fa-circle-info"];
    const colors = ["", "teal", "gold"];

    return `
      <article class="announcement-item">
        <div class="announcement-icon ${colors[index % 3]}"><i class="fa-solid ${icons[index % 3]}"></i></div>
        <div class="announcement-body">
          <h4>${escapeHTML(item.title)}</h4>
          <p>${escapeHTML(item.message)}</p>
          <small>${escapeHTML(formatDate(item.date))}</small>
        </div>
        ${canDelete ? `<button type="button" class="btn btn-outline btn-small announcement-delete" data-action="delete-announcement" data-id="${escapeHTML(item.id)}" aria-label="Delete announcement"><i class="fa-solid fa-trash"></i></button>` : ""}
      </article>`;
  }

  const sortedAnnouncements = () =>
    [...getAnnouncements()].sort((a, b) => String(b.date).localeCompare(String(a.date)));

  function renderAnnouncements() {
    const list = sortedAnnouncements();
    $("announcement-list").innerHTML = list.length
      ? list.map((item, i) => announcementMarkup(item, i, isRegistrar())).join("")
      : '<p class="empty-state">No announcements yet.</p>';
  }

  function renderHomeAnnouncements() {
    const list = sortedAnnouncements().slice(0, 2);
    $("home-announcements").innerHTML = list.length
      ? list.map((item, i) => announcementMarkup(item, i, false)).join("")
      : '<p class="empty-state">No announcements yet.</p>';
  }

  function handleAnnouncementSubmit(event) {
    event.preventDefault();
    if (!requireRegistrar()) return;

    const titleInput = $("announcement-title");
    const messageInput = $("announcement-message");
    const title = titleInput.value.trim();
    const message = messageInput.value.trim();
    const errors = [];

    if (title.length < 3) errors.push([titleInput, "Enter a title (at least 3 characters)."]);
    if (message.length < 5) errors.push([messageInput, "Enter a message (at least 5 characters)."]);
    if (!applyErrors($("announcement-form"), errors)) return;

    const list = getAnnouncements().slice();
    list.push({ id: generateId("announcement"), title, message, date: new Date().toISOString() });
    if (!saveAnnouncements(list)) return;

    logAudit("Announcement published", title);
    resetFormFully($("announcement-form"));
    renderAnnouncements();
    showToast("Announcement published.", "success");
  }

  async function deleteAnnouncement(id) {
    if (!requireRegistrar()) return;

    const item = getAnnouncements().find((a) => a.id === id);
    if (!item) return;

    const ok = await askConfirm({ title: "Delete announcement?", message: `"${item.title}" will be removed for everyone.` });
    if (!ok) return;

    saveAnnouncements(getAnnouncements().filter((a) => a.id !== id));
    logAudit("Announcement deleted", item.title);
    renderAnnouncements();
    showToast("Announcement deleted.", "success");
  }

  /* ==========================================================
     17. PROFILE AND CHANGE PASSWORD
     ========================================================== */

  function openProfile() {
    if (!currentUser) return;

    const record = isRegistrar() ? null : getStudentRecord(currentUser.identifier);

    $("profile-avatar").textContent = initials(currentUser.fullName);
    $("profile-name").textContent = currentUser.fullName;
    $("profile-role").textContent = isRegistrar() ? "Registrar" : "Student";

    const rows = [[isRegistrar() ? "E-mail" : "Student ID", currentUser.identifier]];

    if (!isRegistrar()) {
      rows.push(
        ["Program", currentUser.program || "—"],
        ["Year level", yearLabel(currentUser.program, currentUser.year)],
        ["Status", record?.status || "Active"]
      );
    }

    rows.push(["Last login", currentUser.previousLogin ? formatDateTime(currentUser.previousLogin) : "This is your first login"]);

    $("profile-details").innerHTML = rows.map(([k, v]) => `<dt>${escapeHTML(k)}</dt><dd>${escapeHTML(v)}</dd>`).join("");

    $("contact-section").classList.toggle("hidden", isRegistrar());
    resetFormFully($("contact-form"));
    resetFormFully($("password-form"));

    if (record) {
      $("profile-email").value = record.email || "";
      $("profile-contact").value = record.contact || "";
    }

    openModal("modal-profile");
  }

  function saveContact(event) {
    event.preventDefault();
    if (!currentUser || isRegistrar()) return;

    const emailInput = $("profile-email");
    const contactInput = $("profile-contact");
    const email = emailInput.value.trim();
    const contact = contactInput.value.trim();
    const errors = [];

    if (email && !validEmail(email)) errors.push([emailInput, "Enter a valid e-mail address."]);
    if (contact && !/^09\d{9}$/.test(contact)) errors.push([contactInput, "Use an 11-digit mobile number starting with 09."]);
    if (!applyErrors($("contact-form"), errors)) return;

    const students = getStudents();
    const record = students.find((s) => s.studentId === currentUser.identifier);
    if (!record) return showToast("Your student record was not found.", "error");

    Object.assign(record, { email, contact });
    if (!saveStudents(students)) return;

    logAudit("Contact updated", "Student updated own contact details");
    showToast("Contact information saved.", "success");
  }

  function changePassword(event) {
    event.preventDefault();
    if (!currentUser) return;

    const currentInput = $("pw-current");
    const newInput = $("pw-new");
    const confirmInput = $("pw-confirm");

    const users = getUsers();
    const account = users.find((u) => u.id === currentUser.id);
    const errors = [];

    if (!account || !passwordMatches(account, currentInput.value)) errors.push([currentInput, "Current password is incorrect."]);

    const problem = passwordProblem(newInput.value);
    if (problem) errors.push([newInput, problem]);
    else if (newInput.value === currentInput.value) errors.push([newInput, "The new password must be different."]);

    if (newInput.value !== confirmInput.value) errors.push([confirmInput, "The passwords do not match."]);

    if (!applyErrors($("password-form"), errors)) return;

    account.salt = makeSalt();
    account.passHash = hashPassword(newInput.value, account.salt);
    if (!saveUsers(users)) return;

    logAudit("Password changed", "");
    resetFormFully($("password-form"));
    showToast("Password updated successfully.", "success");
  }

  /* ==========================================================
     18. CSV EXPORT
     ========================================================== */

  function csvCell(value) {
    let text = String(value ?? "");
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`; // stops spreadsheet formula injection
    return `"${text.replace(/"/g, '""')}"`;
  }

  function downloadCsv(filename, rows) {
    const csv = "﻿" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));

    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();

    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast("File exported to CSV.", "success");
  }

  /* ==========================================================
     19. EVENTS, IDLE LOGOUT AND STARTUP
     ========================================================== */

  /* ---------- Idle logout ---------- */

  ["pointerdown", "keydown", "scroll", "touchstart"].forEach((name) =>
    document.addEventListener(name, () => { lastActivity = Date.now(); }, { passive: true, capture: true })
  );

  window.setInterval(() => {
    if (currentUser && Date.now() - lastActivity > IDLE_MINUTES * 60 * 1000) logoutUser("idle");
  }, 30000);

  /* ---------- Login screen ---------- */

  document.querySelectorAll(".portal-tab-btn").forEach((button) =>
    button.addEventListener("click", () => setRole(button.dataset.role)));

  $("login-mode-btn").addEventListener("click", () => setAuthMode("login"));
  $("register-mode-btn").addEventListener("click", () => setAuthMode("register"));
  $("auth-form").addEventListener("submit", handleAuthentication);
  $("auth-password").addEventListener("input", updatePasswordMeter);

  $("auth-program").addEventListener("change", () => fillYearSelect($("auth-year"), $("auth-program").value));
  $("stu-program").addEventListener("change", () => fillYearSelect($("stu-year"), $("stu-program").value));

  bindStudentIdInput($("auth-identifier"), () => selectedRole === ROLE_STU);
  bindStudentIdInput($("stu-id"), () => !$("stu-id").readOnly);
  bindNameInput($("auth-fullname"));
  bindNameInput($("stu-name"));
  bindDigitsInput($("stu-contact"), 11);
  bindDigitsInput($("profile-contact"), 11);

  /* ---------- Header ---------- */

  $("logout-btn").addEventListener("click", () => logoutUser());
  $("profile-btn").addEventListener("click", openProfile);

  $("mobile-nav-toggle").addEventListener("click", () => {
    const open = $("app-nav").classList.toggle("open");
    $("mobile-nav-toggle").setAttribute("aria-expanded", String(open));
    $("mobile-nav-toggle").innerHTML = open ? '<i class="fa-solid fa-xmark"></i>' : '<i class="fa-solid fa-bars"></i>';
  });

  /* ---------- One click handler for pages, actions and dialogs ---------- */

  document.addEventListener("click", (event) => {
    if (event.target.classList?.contains("modal-backdrop")) {
      closeModal(event.target.id);
      return;
    }

    const toggle = event.target.closest("[data-toggle]");
    if (toggle) {
      const input = $(toggle.dataset.toggle);
      if (input) setSecretVisible(input, !isSecretVisible(input));
      return;
    }

    const closer = event.target.closest("[data-close]");
    if (closer) {
      closeModal(closer.dataset.close);
      return;
    }

    const pageButton = event.target.closest("[data-page]");
    if (pageButton) {
      event.preventDefault();
      if (!$("app-container").classList.contains("hidden")) navigateTo(pageButton.dataset.page);
      return;
    }

    const actionButton = event.target.closest("[data-action]");
    if (!actionButton) return;

    const { action, id } = actionButton.dataset;

    if (action === "edit-grade") editGrade(id);
    else if (action === "delete-grade") deleteGrade(id);
    else if (action === "edit-student") editStudent(id);
    else if (action === "delete-student") deleteStudent(id);
    else if (action === "delete-announcement") deleteAnnouncement(id);
    else if (action === "student-grades") {
      navigateTo("grades");
      $("student-filter").value = id;
      renderGrades();
    }
  });

  $("confirm-yes").addEventListener("click", () => answerConfirm(true));
  $("confirm-no").addEventListener("click", () => answerConfirm(false));

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      const open = document.querySelectorAll(".modal-backdrop:not(.hidden)");
      if (open.length) closeModal(open[open.length - 1].id);
    }
    trapFocus(event);
  });

  /* ---------- Clear an error as soon as the field is edited ---------- */

  const clearOnEdit = (event) => {
    const group = event.target.closest?.(".input-group.has-error");
    if (group && event.target.matches("input, select, textarea")) setFieldError(event.target, "");
  };
  document.addEventListener("change", clearOnEdit);
  document.addEventListener("input", (event) => {
    // The student-ID box shows its own short notice while typing.
    if (event.target.id === "auth-identifier" || event.target.id === "stu-id") return;
    clearOnEdit(event);
  });

  /* ---------- Grades page ---------- */

  ["grade-search"].forEach((id) => $(id).addEventListener("input", renderGrades));
  ["semester-filter", "school-year-filter", "student-filter", "grade-sort"].forEach((id) =>
    $(id).addEventListener("change", renderGrades));

  $("export-grades-btn").addEventListener("click", exportGradesCsv);
  $("print-grades-btn").addEventListener("click", () => {
    renderGrades();
    logAudit("Grades printed", "");
    window.print();
  });

  /* ---------- Grade encoding ---------- */

  $("grade-form").addEventListener("submit", handleGradeSubmit);
  $("grade-method").addEventListener("change", updateMethodUI);
  ["grade-prelim", "grade-midterm", "grade-final", "grade-value"].forEach((id) =>
    $(id).addEventListener("input", updateGradePreview));
  $("cancel-grade-edit").addEventListener("click", resetGradeForm);

  $("manage-grade-search").addEventListener("input", renderManageGrades);
  $("manage-semester-filter").addEventListener("change", renderManageGrades);
  $("export-manage-btn").addEventListener("click", exportManageCsv);

  /* ---------- Students ---------- */

  $("student-form").addEventListener("submit", handleStudentSubmit);
  $("cancel-student-edit").addEventListener("click", resetStudentForm);
  $("student-search").addEventListener("input", renderStudents);
  $("student-program-filter").addEventListener("change", renderStudents);
  $("export-students-btn").addEventListener("click", exportStudentsCsv);

  /* ---------- Reports ---------- */

  ["report-type", "report-student", "report-period"].forEach((id) => $(id).addEventListener("change", renderReport));
  $("export-report-btn").addEventListener("click", exportReportCsv);
  $("print-report-btn").addEventListener("click", printReport);

  /* ---------- Announcements and profile ---------- */

  $("announcement-form").addEventListener("submit", handleAnnouncementSubmit);
  $("contact-form").addEventListener("submit", saveContact);
  $("password-form").addEventListener("submit", changePassword);

  /* ---------- Back / forward cache: never show an old filled-in form ---------- */

  window.addEventListener("pageshow", (event) => {
    if (event.persisted && !currentUser) {
      clearAuthForm();
      updateAuthModeUI();
    }
  });

  /* ---------- Startup ---------- */

  fillProgramSelect($("auth-program"));
  fillProgramSelect($("stu-program"));
  fillYearSelect($("auth-year"), $("auth-program").value);
  fillYearSelect($("stu-year"), $("stu-program").value);

  hardenAllInputs();
  initializeStorage();

  clearAuthForm();
  updateAuthModeUI();
  resetGradeForm();
  resetStudentForm();

  if (restoreSession()) {
    showApplication();
  } else {
    $("auth-screen").classList.remove("hidden");
    $("app-container").classList.add("hidden");
  }
});
document.addEventListener("click", (event) => {
  const button = event.target.closest(".pw-toggle");
  if (!button) return;

  const input = document.getElementById(button.dataset.toggle);
  if (!input) return;

  const show = input.type === "password";
  input.type = show ? "text" : "password";

  button.setAttribute("aria-label", show ? "Hide password" : "Show password");
  button.innerHTML = `<i class="fa-solid ${show ? "fa-eye-slash" : "fa-eye"}"></i>`;
});