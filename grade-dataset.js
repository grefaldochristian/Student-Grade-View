/* ==========================================================
   VERITAS COLLEGE OF IROSIN - SAMPLE DATASET
   Loaded before script.js. Seeds localStorage with sample grades.
   ========================================================== */

const INITIAL_GRADE_DATASET = [
  {
    id: "GRD-001",
    studentName: "Bryan Elquiero",
    studentId: "2024-6348",
    program: "BSIT",
    yearLevel: "2",
    subjectCode: "IT211",
    subjectDescription: "Data Structures & Algorithms",
    units: 3,
    grade: 1.25,
    period: "1st Sem 2025-2026"
  },
  {
    id: "GRD-002",
    studentName: "Bryan Elquiero",
    studentId: "2024-6348",
    program: "BSIT",
    yearLevel: "2",
    subjectCode: "IT212",
    subjectDescription: "Object-Oriented Programming (C#)",
    units: 3,
    grade: 1.50,
    period: "1st Sem 2025-2026"
  },
  {
    id: "GRD-003",
    studentName: "Bryan Elquiero",
    studentId: "2024-6348",
    program: "BSIT",
    yearLevel: "2",
    subjectCode: "IT213",
    subjectDescription: "Database Management Systems (MySQL)",
    units: 3,
    grade: 1.25,
    period: "1st Sem 2025-2026"
  },
  {
    id: "GRD-004",
    studentName: "Noeme Gojo",
    studentId: "2024-1102",
    program: "BSIT",
    yearLevel: "2",
    subjectCode: "IT211",
    subjectDescription: "Data Structures & Algorithms",
    units: 3,
    grade: 1.50,
    period: "1st Sem 2025-2026"
  },

  /* ---- Additional sample records (added in v3 so the dashboard has data to show) ---- */
  {
    id: "GRD-005",
    studentName: "Bryan Elquiero",
    studentId: "2024-6348",
    program: "BSIT",
    yearLevel: "2",
    subjectCode: "IT221",
    subjectDescription: "Web Systems and Technologies",
    units: 3,
    grade: 1.50,
    period: "2nd Sem 2025-2026"
  },
  {
    id: "GRD-006",
    studentName: "Bryan Elquiero",
    studentId: "2024-6348",
    program: "BSIT",
    yearLevel: "2",
    subjectCode: "IT222",
    subjectDescription: "Networking Fundamentals",
    units: 3,
    grade: 1.75,
    period: "2nd Sem 2025-2026"
  },
  {
    id: "GRD-007",
    studentName: "Bryan Elquiero",
    studentId: "2024-6348",
    program: "BSIT",
    yearLevel: "2",
    subjectCode: "MATH201",
    subjectDescription: "Discrete Mathematics",
    units: 3,
    grade: 2.00,
    period: "2nd Sem 2025-2026"
  },
  {
    id: "GRD-008",
    studentName: "Noeme Gojo",
    studentId: "2024-1102",
    program: "BSIT",
    yearLevel: "2",
    subjectCode: "IT212",
    subjectDescription: "Object-Oriented Programming (C#)",
    units: 3,
    grade: 1.75,
    period: "1st Sem 2025-2026"
  },
  {
    id: "GRD-009",
    studentName: "Noeme Gojo",
    studentId: "2024-1102",
    program: "BSIT",
    yearLevel: "2",
    subjectCode: "IT213",
    subjectDescription: "Database Management Systems (MySQL)",
    units: 3,
    grade: 2.00,
    period: "1st Sem 2025-2026"
  },
  {
    id: "GRD-010",
    studentName: "Maria Santos",
    studentId: "2024-1175",
    program: "BSIT",
    yearLevel: "2",
    subjectCode: "IT211",
    subjectDescription: "Data Structures & Algorithms",
    units: 3,
    grade: 2.50,
    period: "1st Sem 2025-2026"
  },
  {
    id: "GRD-011",
    studentName: "Maria Santos",
    studentId: "2024-1175",
    program: "BSIT",
    yearLevel: "2",
    subjectCode: "IT212",
    subjectDescription: "Object-Oriented Programming (C#)",
    units: 3,
    grade: 2.75,
    period: "1st Sem 2025-2026"
  },
  {
    id: "GRD-012",
    studentName: "Maria Santos",
    studentId: "2024-1175",
    program: "BSIT",
    yearLevel: "2",
    subjectCode: "IT213",
    subjectDescription: "Database Management Systems (MySQL)",
    units: 3,
    grade: 3.25,
    period: "1st Sem 2025-2026"
  }
];

/*
  Seeding rules:
  - First visit: save the whole dataset.
  - Later visits with an older seed version: add ONLY the records whose
    id is missing (existing or edited records are never overwritten).
*/
(function seedGradeDataset() {
  const DB_KEY = "veritas_grades_db";
  const VERSION_KEY = "veritas_grades_seed_version";
  const SEED_VERSION = "2";

  try {
    const stored = localStorage.getItem(DB_KEY);

    if (!stored) {
      localStorage.setItem(DB_KEY, JSON.stringify(INITIAL_GRADE_DATASET));
      localStorage.setItem(VERSION_KEY, SEED_VERSION);
      return;
    }

    if (localStorage.getItem(VERSION_KEY) === SEED_VERSION) return;

    const current = JSON.parse(stored);

    if (Array.isArray(current)) {
      const knownIds = new Set(current.map((record) => record && record.id));
      const missing = INITIAL_GRADE_DATASET.filter(
        (record) => !knownIds.has(record.id)
      );

      localStorage.setItem(DB_KEY, JSON.stringify([...current, ...missing]));
    }

    localStorage.setItem(VERSION_KEY, SEED_VERSION);
  } catch (error) {
    console.warn("Sample grade data could not be saved:", error);
  }
})();