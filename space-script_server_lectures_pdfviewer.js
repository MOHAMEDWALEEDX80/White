// space-script.js
// النظام التفاعلي للمنصة الفضائية

// قاعدة بيانات المتصدرين العالمية
const GLOBAL_LEADERBOARD_KEY = 'global_challenge_leaderboard_v2';

// إعدادات مدة الامتحان (محلياً داخل المتصفح)
const CHALLENGE_DURATION_KEY = 'spacePlatform_challengeDurationSeconds_v1';
const QUICK_EXAM_DURATION_KEY = 'spacePlatform_quickExamDurationSeconds_v1';
const DEFAULT_CHALLENGE_DURATION_SECONDS = 5 * 60;
const DEFAULT_QUICK_EXAM_DURATION_SECONDS = 10 * 60;

// اسم مادة وضع التحدي (يمكن تعديله من صفحة الأدمن)
const CHALLENGE_SUBJECT_NAME_KEY = 'spacePlatform_challengeSubjectName_v1';
const DEFAULT_CHALLENGE_SUBJECT_NAME = 'وضع التحدي';

// إعدادات عامة يمكن مشاركتها عبر Firebase (اختياري)
const FIRESTORE_CONFIG_COLLECTION = 'examConfig_v1';

function getChallengeSubjectName() {
    return String(localStorage.getItem(CHALLENGE_SUBJECT_NAME_KEY) || '').trim() || DEFAULT_CHALLENGE_SUBJECT_NAME;
}

function setChallengeSubjectName(name) {
    const clean = String(name || '').trim();
    if (!clean) {
        localStorage.removeItem(CHALLENGE_SUBJECT_NAME_KEY);
    } else {
        localStorage.setItem(CHALLENGE_SUBJECT_NAME_KEY, clean);
    }
    applyChallengeSubjectNameToUI();
}

function applyChallengeSubjectNameToUI() {
    const subjectName = getChallengeSubjectName();

    const introLabel = document.getElementById('challengeSubjectNameIntro');
    if (introLabel) introLabel.textContent = subjectName;

    const inExamLabel = document.getElementById('challengeSubjectNameInExam');
    if (inExamLabel) inExamLabel.textContent = subjectName;

    // تحديث حقل الأدمن لو موجود
    const input = document.getElementById('challengeSubjectNameInput');
    if (input) {
        const isFocused = document.activeElement === input;
        if (!isFocused) {
            input.value = subjectName;
        }
    }
}

// فلترة اسم المادة (يسمح بالأرقام وبعض الرموز البسيطة)
function filterSubjectName(subject) {
    if (!subject) return '';
    let s = String(subject).replace(/\s+/g, ' ').trim();
    const lower = s.toLowerCase();

    for (const word of bannedWords) {
        const regex = new RegExp(word, 'gi');
        if (regex.test(lower) || regex.test(s)) return null;
    }

    if (s.length < 2 || s.length > 60) return null;

    // يسمح: عربي/إنجليزي + أرقام + مسافات + - _ ( )
    const valid = /^[\u0600-\u06FFa-zA-Z0-9 \-()_]+$/;
    if (!valid.test(s)) return null;

    // رفض التكرار المبالغ فيه
    if (/(.)\1{4,}/.test(s)) return null;

    return s;
}

async function saveChallengeSubjectNameToFirestore(subjectName) {
    try {
        if (!isFirestoreReady()) return false;
        const api = window.firestoreApi;
        const db = window.firestoreDb;
        const payload = {
            type: 'challengeSubjectName',
            value: subjectName,
            createdAtMs: Date.now(),
            createdAt: api.serverTimestamp()
        };
        await api.addDoc(api.collection(db, FIRESTORE_CONFIG_COLLECTION), payload);
        return true;
    } catch (e) {
        console.warn('Failed to save challenge subject name to Firestore:', e);
        return false;
    }
}

async function syncChallengeSubjectNameFromFirestore() {
    try {
        if (!isFirestoreReady()) return false;
        const api = window.firestoreApi;
        const db = window.firestoreDb;

        const q = api.query(
            api.collection(db, FIRESTORE_CONFIG_COLLECTION),
            api.orderBy('createdAtMs', 'desc'),
            api.limit(50)
        );

        const snap = await api.getDocs(q);

        let latest = null;
        snap.forEach(docSnap => {
            const d = docSnap.data();
            if (!latest && d && d.type === 'challengeSubjectName' && typeof d.value === 'string' && d.value.trim()) {
                latest = d.value.trim();
            }
        });

        if (latest) {
            localStorage.setItem(CHALLENGE_SUBJECT_NAME_KEY, latest);
            applyChallengeSubjectNameToUI();

            const input = document.getElementById('challengeSubjectNameInput');
            if (input) input.value = latest;

            return true;
        }
        return false;
    } catch (e) {
        console.warn('Failed to sync challenge subject name from Firestore:', e);
        return false;
    }
}

// تهيئة اسم المادة (قبل/أثناء التحدي + داخل صفحة الأدمن)
function initChallengeSubjectUI() {
    // تطبيق القيمة الحالية فوراً
    applyChallengeSubjectNameToUI();

    // محاولة جلب آخر قيمة من Firebase (لو متاح)
    syncChallengeSubjectNameFromFirestore();
}


function clampInt(value, min, max, fallback) {
    const n = parseInt(value, 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
}

function getChallengeDurationSeconds() {
    const saved = localStorage.getItem(CHALLENGE_DURATION_KEY);
    return clampInt(saved, 60, 60 * 60, DEFAULT_CHALLENGE_DURATION_SECONDS);
}

function getQuickExamDurationSeconds() {
    const saved = localStorage.getItem(QUICK_EXAM_DURATION_KEY);
    return clampInt(saved, 60, 60 * 60, DEFAULT_QUICK_EXAM_DURATION_SECONDS);
}

function setChallengeDurationSeconds(seconds) {
    const s = clampInt(seconds, 60, 60 * 60, DEFAULT_CHALLENGE_DURATION_SECONDS);
    localStorage.setItem(CHALLENGE_DURATION_KEY, String(s));
}

function setQuickExamDurationSeconds(seconds) {
    const s = clampInt(seconds, 60, 60 * 60, DEFAULT_QUICK_EXAM_DURATION_SECONDS);
    localStorage.setItem(QUICK_EXAM_DURATION_KEY, String(s));
}



// =====================
// مزامنة مدة الامتحان/التحدي مع Firestore (عشان أي تغيير من الأدمن ينعكس عند الكل)
// =====================

let __examDurationsUnsub = null;

async function saveExamDurationsToFirestore({ challengeSeconds, quickSeconds }) {
    try {
        if (!isFirestoreReady()) return false;

        const ch = clampInt(challengeSeconds, 60, 60 * 60, DEFAULT_CHALLENGE_DURATION_SECONDS);
        const q = clampInt(quickSeconds, 60, 60 * 60, DEFAULT_QUICK_EXAM_DURATION_SECONDS);

        const api = window.firestoreApi;
        const db = window.firestoreDb;

        const payload = {
            type: 'examDurations',
            value: { challengeSeconds: ch, quickSeconds: q },
            createdAtMs: Date.now(),
            createdAt: api.serverTimestamp()
        };

        await api.addDoc(api.collection(db, FIRESTORE_CONFIG_COLLECTION), payload);
        return true;
    } catch (e) {
        console.warn('Failed to save exam durations to Firestore:', e);
        return false;
    }
}

function applySyncedExamDurations(value, { refreshUI = true } = {}) {
    try {
        const ch = clampInt(value?.challengeSeconds, 60, 60 * 60, DEFAULT_CHALLENGE_DURATION_SECONDS);
        const q = clampInt(value?.quickSeconds, 60, 60 * 60, DEFAULT_QUICK_EXAM_DURATION_SECONDS);

        const oldCh = getChallengeDurationSeconds();
        const oldQ = getQuickExamDurationSeconds();
        if (oldCh === ch && oldQ === q) return;

        setChallengeDurationSeconds(ch);
        setQuickExamDurationSeconds(q);

        if (refreshUI) {
            // تحديث الواجهة (بدون ما نوقف أي امتحان شغال)
            try { initDurationSettingsUI(); } catch (e) {}
        }
    } catch (e) {
        // ignore
    }
}

async function syncExamDurationsFromFirestore() {
    try {
        if (!isFirestoreReady()) return false;

        const api = window.firestoreApi;
        const db = window.firestoreDb;

        const q = api.query(
            api.collection(db, FIRESTORE_CONFIG_COLLECTION),
            api.orderBy('createdAtMs', 'desc'),
            api.limit(50)
        );

        const snap = await api.getDocs(q);

        let latest = null;
        snap.forEach(docSnap => {
            const d = docSnap.data();
            if (!latest && d && d.type === 'examDurations' && d.value && typeof d.value === 'object') {
                latest = d.value;
            }
        });

        if (!latest) return false;

        applySyncedExamDurations(latest, { refreshUI: true });
        return true;
    } catch (e) {
        console.warn('Failed to sync exam durations from Firestore:', e);
        return false;
    }
}

function initExamDurationsSync() {
    // one-time pull
    syncExamDurationsFromFirestore();

    // real-time updates (بدون Refresh)
    try {
        if (!isFirestoreReady()) return;
        if (__examDurationsUnsub) return;

        const api = window.firestoreApi;
        const db = window.firestoreDb;

        const q = api.query(
            api.collection(db, FIRESTORE_CONFIG_COLLECTION),
            api.orderBy('createdAtMs', 'desc'),
            api.limit(50)
        );

        __examDurationsUnsub = api.onSnapshot(q, (snap) => {
            let latest = null;
            snap.forEach(docSnap => {
                const d = docSnap.data();
                if (!latest && d && d.type === 'examDurations' && d.value && typeof d.value === 'object') {
                    latest = d.value;
                }
            });

            if (!latest) return;
            applySyncedExamDurations(latest, { refreshUI: true });
        }, (err) => {
            console.warn('Exam durations realtime sync failed:', err);
        });
    } catch (e) {
        console.warn('Failed to init exam durations sync:', e);
    }
}

function formatMMSS(totalSeconds) {
    const s = Math.max(0, parseInt(totalSeconds, 10) || 0);
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}


// بيانات التطبيق
const appData = {
    currentUser: null,
    firebaseUser: null,
    userProfile: null,
    currentRole: 'student',
    _presenceInterval: null,
    _profileUnsub: null,
    currentSection: 'home',
    activeExam: null,
    leaderboard: [],
    challengeResults: [],
    aiChatHistory: [],
    questionsBank: {
        physics: [
            {
                question: "ما هو قانون نيوتن الأول؟",
                options: [
                    "يبقى الجسم الساكن ساكناً والمتحرك متحركاً ما لم تؤثر عليه قوة خارجية",
                    "القوة تساوي الكتلة مضروبة في التسارع",
                    "لكل فعل رد فعل مساوٍ له في المقدار ومعاكس له في الاتجاه",
                    "الطاقة لا تفنى ولا تستحدث من عدم"
                ],
                correct: 0,
                difficulty: "easy",
                subject: "physics"
            },
            {
                question: "ما وحدة قياس القوة في النظام الدولي؟",
                options: ["نيوتن", "جول", "واط", "باسكال"],
                correct: 0,
                difficulty: "easy",
                subject: "physics"
            },
            {
                question: "كيف يمكن حساب الشغل المبذول؟",
                options: [
                    "القوة × المسافة",
                    "الكتلة × التسارع",
                    "القدرة × الزمن",
                    "الضغط × الحجم"
                ],
                correct: 0,
                difficulty: "medium",
                subject: "physics"
            },
            {
                question: "ما هو قانون حفظ الطاقة؟",
                options: [
                    "الطاقة لا تفنى ولا تستحدث من عدم ولكن تتحول من شكل لآخر",
                    "الطاقة تزداد مع الزمن",
                    "الطاقة تتناقص مع المسافة",
                    "الطاقة تعتمد على درجة الحرارة فقط"
                ],
                correct: 0,
                difficulty: "medium",
                subject: "physics"
            },
            {
                question: "ما الذي يحدد مقدار قوة الجاذبية بين جسمين؟",
                options: [
                    "كتلتيهما والمسافة بينهما",
                    "شكل الجسمين فقط",
                    "سرعة الجسمين",
                    "درجة حرارة الجسمين"
                ],
                correct: 0,
                difficulty: "hard",
                subject: "physics"
            }
        ],
        electronics: [
            {
                question: "ما هو الفرق بين الموصل والعازل؟",
                options: [
                    "الموصل يسمح بمرور التيار والعازل لا يسمح",
                    "الموصل للكهرباء والعازل للحرارة",
                    "الموصل للضوء والعازل للصوت",
                    "لا فرق بينهما"
                ],
                correct: 0,
                difficulty: "easy",
                subject: "electronics"
            },
            {
                question: "ما هي وحدة قياس المقاومة الكهربائية؟",
                options: ["أوم", "فولت", "أمبير", "واط"],
                correct: 0,
                difficulty: "easy",
                subject: "electronics"
            },
            {
                question: "ما هو قانون أوم؟",
                options: [
                    "الجهد = التيار × المقاومة",
                    "القدرة = الجهد × التيار",
                    "الشحنة = التيار × الزمن",
                    "المقاومة = الجهد ÷ التيار"
                ],
                correct: 0,
                difficulty: "medium",
                subject: "electronics"
            },
            {
                question: "ما هي أشباه الموصلات؟",
                options: [
                    "مواد تتوسط في التوصيل بين الموصلات والعوازل",
                    "مواد لا توصل الكهرباء إطلاقاً",
                    "مواد توصل الكهرباء بدرجة عالية",
                    "مواد مغناطيسية فقط"
                ],
                correct: 0,
                difficulty: "medium",
                subject: "electronics"
            },
            {
                question: "ما هو الثنائي (الدايود)؟",
                options: [
                    "مكون إلكتروني يسمح بمرور التيار في اتجاه واحد فقط",
                    "مكون يخزن الطاقة الكهربائية",
                    "مكون يضخم الإشارات الكهربائية",
                    "مكون يولد تياراً متردداً"
                ],
                correct: 0,
                difficulty: "hard",
                subject: "electronics"
            }
        ],
        math: [
            {
                question: "ما هو حل المعادلة: 2x + 5 = 15؟",
                options: ["5", "10", "7.5", "20"],
                correct: 0,
                difficulty: "easy",
                subject: "math"
            },
            {
                question: "ما قيمة س في المعادلة: س² - 4 = 0؟",
                options: ["2 و -2", "4", "0", "1"],
                correct: 0,
                difficulty: "easy",
                subject: "math"
            },
            {
                question: "ما هو مشتق الدالة f(x) = x³؟",
                options: ["3x²", "x²", "3x", "x³"],
                correct: 0,
                difficulty: "medium",
                subject: "math"
            },
            {
                question: "ما هو تكامل الدالة f(x) = 2x؟",
                options: ["x²", "2x²", "x", "2"],
                correct: 0,
                difficulty: "medium",
                subject: "math"
            },
            {
                question: "ما هو محيط دائرة نصف قطرها 7 سم؟",
                options: ["14π سم", "7π سم", "49π سم", "28π سم"],
                correct: 0,
                difficulty: "hard",
                subject: "math"
            }
        ],
        english: [
            {
                question: "What is the past tense of 'go'?",
                options: ["went", "goed", "gone", "going"],
                correct: 0,
                difficulty: "easy",
                subject: "english"
            },
            {
                question: "Which sentence is correct?",
                options: [
                    "I have been studying for two hours",
                    "I has been studying for two hours",
                    "I have being studied for two hours",
                    "I have be studying for two hours"
                ],
                correct: 0,
                difficulty: "easy",
                subject: "english"
            },
            {
                question: "What is the plural of 'child'?",
                options: ["children", "childs", "childes", "child"],
                correct: 0,
                difficulty: "medium",
                subject: "english"
            },
            {
                question: "Which word is a synonym for 'happy'?",
                options: ["joyful", "sad", "angry", "tired"],
                correct: 0,
                difficulty: "medium",
                subject: "english"
            },
            {
                question: "What is the correct passive form of: 'They built this house in 1990'?",
                options: [
                    "This house was built in 1990",
                    "This house is built in 1990",
                    "This house built in 1990",
                    "This house has been built in 1990"
                ],
                correct: 0,
                difficulty: "hard",
                subject: "english"
            }
        ]
    }
};

// أسئلة وضع التحدي (الافتراضية)
const DEFAULT_CHALLENGE_QUESTIONS = [
    {
        question: "In Young's double-slit experiment, constructive interference occurs when the path difference is...",
        options: ["mλ", "(m+1/2)λ", "1/2 mλ", "Zero"],
        correct: 0
    },
    {
        question: "In an interference pattern, the distance between two adjacent bright fringes is determined by...",
        options: ["The wavelength of light and the slit separation", "The screen's distance from the slits only", "The intensity of the light", "The angle of incidence"],
        correct: 0
    },
    {
        question: "What is the primary function of a p-n junction diode in a rectifier circuit?",
        options: ["Convert AC voltage to DC voltage", "Amplify signals", "Generate light", "Store data"],
        correct: 0
    },
    {
        question: "What happens to a diode when it is reverse-biased?",
        options: ["No current flows (or extremely small leakage)", "Current flows freely", "Electrons are emitted", "Voltage decreases"],
        correct: 0
    },
    {
        question: "Which semiconductor material is commonly used to make diodes?",
        options: ["Silicon", "Aluminum", "Copper", "Gold"],
        correct: 0
    },
    {
        question: "In a half-wave rectifier circuit, how many diodes are used to convert AC to DC?",
        options: ["One", "Two", "Three", "Four"],
        correct: 0
    },
    {
        question: "What is the voltage drop across a germanium diode when it is forward-biased?",
        options: ["0.3 volts", "0 volts", "0.7 volts", "1 volt"],
        correct: 0
    },
    {
        question: "In time dilation, the moving clock observed from a stationary frame appears...",
        options: ["Slower", "Faster", "Unaffected", "Random"],
        correct: 0
    },
    {
        question: "Which of the following is NOT a source of a magnetic field?",
        options: ["Stationary Electric charge", "Permanent magnets", "Electric charge in motion", "Ferromagnetic materials"],
        correct: 0
    },
    {
        question: "The Biot-Savart law describes the magnetic field due to...",
        options: ["A current-carrying conductor", "A stationary charge", "A moving point charge", "A magnetic dipole"],
        correct: 0
    },
    {
        question: "In a magnetic field, the force on a charged particle is...",
        options: ["Perpendicular to both velocity and magnetic field", "Opposite to the magnetic field direction", "Zero if the particle is moving", "Along the direction of the magnetic field"],
        correct: 0
    },
    {
        question: "A semiconductor has generally ... valence electrons",
        options: ["4", "5", "2", "8"],
        correct: 0
    },
    {
        question: "When a pentavalent impurity is added to a pure semiconductor, it becomes...",
        options: ["n-type semiconductor", "an insulator", "an intrinsic semiconductor", "p-type semiconductor"],
        correct: 0
    },
    {
        question: "In double slit experiment we observe...",
        options: ["Both interference and diffraction fringes", "Diffraction fringes only", "Interference fringes only", "Polarized fringes"],
        correct: 0
    },
    {
        question: "A reverse biased pn junction has",
        options: ["almost no current", "very narrow depletion layer", "very low resistance", "large current flow"],
        correct: 0
    },
    {
        question: "What is the SI unit of electric current?",
        options: ["Ampere", "Volt", "Ohm", "Watt"],
        correct: 0
    },
    {
        question: "Which law states that the induced EMF is proportional to the rate of change of magnetic flux?",
        options: ["Faraday's law", "Ohm's law", "Coulomb's law", "Kirchhoff's law"],
        correct: 0
    },
    {
        question: "What does CPU stand for?",
        options: ["Central Processing Unit", "Computer Processing Unit", "Central Program Unit", "Computer Program Unit"],
        correct: 0
    },
    {
        question: "In programming, what is a variable?",
        options: ["A container for storing data values", "A type of function", "A conditional statement", "A loop structure"],
        correct: 0
    },
    {
        question: "What is the binary equivalent of decimal number 10?",
        options: ["1010", "1001", "1100", "1110"],
        correct: 0
    }
];

// حفظ/تحميل أسئلة وضع التحدي من المتصفح
const CHALLENGE_QUESTIONS_KEY = 'spacePlatform_challengeQuestions_v1';

function normalizeChallengeQuestions(raw) {
    if (!Array.isArray(raw)) return null;

    const cleaned = raw
        .map(q => {
            const question = String(q?.question ?? '').trim();
            const optionsRaw = Array.isArray(q?.options) ? q.options : [];
            const options = optionsRaw.slice(0, 4).map(o => String(o ?? '').trim());
            while (options.length < 4) options.push('');

            let correct = Number.isInteger(q?.correct) ? q.correct : parseInt(q?.correct, 10);
            if (!Number.isInteger(correct) || correct < 0 || correct > 3) correct = 0;

            return { question, options, correct };
        })
        // تجاهل العناصر غير الصالحة
        .filter(q => q.question.length > 0 && Array.isArray(q.options) && q.options.length === 4 && q.options.every(o => String(o).trim().length > 0));

    return cleaned;
}


// =====================
// مزامنة أسئلة وضع التحدي مع Firestore (عشان كل المستخدمين يشوفوا نفس الأسئلة)
// =====================

let __challengeQuestionsUnsub = null;

async function saveChallengeQuestionsToFirestore(questions) {
    try {
        if (!isFirestoreReady()) return false;

        const normalized = normalizeChallengeQuestions(questions);
        if (!normalized || normalized.length === 0) return false;

        const api = window.firestoreApi;
        const db = window.firestoreDb;

        const payload = {
            type: 'challengeQuestions',
            value: normalized,
            createdAtMs: Date.now(),
            createdAt: api.serverTimestamp()
        };

        await api.addDoc(api.collection(db, FIRESTORE_CONFIG_COLLECTION), payload);
        return true;
    } catch (e) {
        console.warn('Failed to save challenge questions to Firestore:', e);
        return false;
    }
}

function applySyncedChallengeQuestions(normalized, { renderSettingsIfOpen = true } = {}) {
    try {
        const clean = normalizeChallengeQuestions(normalized);
        if (!clean || clean.length === 0) return;

        const newStr = JSON.stringify(clean);
        const oldStr = localStorage.getItem(CHALLENGE_QUESTIONS_KEY);
        if (oldStr === newStr) return;

        localStorage.setItem(CHALLENGE_QUESTIONS_KEY, newStr);
        challengeQuestions = clean;

        // حدّث الدرافـت في الإعدادات فقط لو مش في نص تعديل
        let canTouchDraft = true;
        try { void challengeQuestionsDraft; } catch (e) { canTouchDraft = false; }

        if (canTouchDraft) {
            const shouldUpdateDraft = (!challengeQuestionsDraft) || (!isAdminUnlocked());
            if (shouldUpdateDraft) {
                try { challengeQuestionsDraft = deepClone(clean); } catch (e) {}
            }

            if (renderSettingsIfOpen && shouldUpdateDraft) {
                try {
                    const isSettingsOpen = (typeof appData !== 'undefined' && appData && appData.currentSection === 'settings');
                    if (isSettingsOpen && isAdminUnlocked()) {
                        renderChallengeQuestionsEditor();
                    }
                } catch (e) {}
            }
        }
    } catch (e) {
        // ignore
    }
}

async function syncChallengeQuestionsFromFirestore() {
    try {
        if (!isFirestoreReady()) return false;

        const api = window.firestoreApi;
        const db = window.firestoreDb;

        const q = api.query(
            api.collection(db, FIRESTORE_CONFIG_COLLECTION),
            api.orderBy('createdAtMs', 'desc'),
            api.limit(50)
        );

        const snap = await api.getDocs(q);

        let latest = null;
        snap.forEach(docSnap => {
            const d = docSnap.data();
            if (!latest && d && d.type === 'challengeQuestions' && Array.isArray(d.value)) {
                latest = d.value;
            }
        });

        if (!latest) return false;

        applySyncedChallengeQuestions(latest, { renderSettingsIfOpen: true });
        return true;
    } catch (e) {
        console.warn('Failed to sync challenge questions from Firestore:', e);
        return false;
    }
}

function initChallengeQuestionsSync() {
    // one-time pull
    syncChallengeQuestionsFromFirestore();

    // real-time updates (بدون ما نحتاج Refresh)
    try {
        if (!isFirestoreReady()) return;
        if (__challengeQuestionsUnsub) return;

        const api = window.firestoreApi;
        const db = window.firestoreDb;

        const q = api.query(
            api.collection(db, FIRESTORE_CONFIG_COLLECTION),
            api.orderBy('createdAtMs', 'desc'),
            api.limit(50)
        );

        __challengeQuestionsUnsub = api.onSnapshot(q, (snap) => {
            let latest = null;
            snap.forEach(docSnap => {
                const d = docSnap.data();
                if (!latest && d && d.type === 'challengeQuestions' && Array.isArray(d.value)) {
                    latest = d.value;
                }
            });

            if (!latest) return;
            applySyncedChallengeQuestions(latest, { renderSettingsIfOpen: true });
        }, (err) => {
            console.warn('Challenge questions realtime sync failed:', err);
        });
    } catch (e) {
        console.warn('Failed to init challenge questions sync:', e);
    }
}

function loadChallengeQuestions() {
    try {
        const saved = localStorage.getItem(CHALLENGE_QUESTIONS_KEY);
        if (!saved) return JSON.parse(JSON.stringify(DEFAULT_CHALLENGE_QUESTIONS));

        const parsed = JSON.parse(saved);
        const normalized = normalizeChallengeQuestions(parsed);
        if (!normalized || normalized.length === 0) {
            return JSON.parse(JSON.stringify(DEFAULT_CHALLENGE_QUESTIONS));
        }
        return normalized;
    } catch (e) {
        console.warn('Failed to load challenge questions, using defaults.', e);
        return JSON.parse(JSON.stringify(DEFAULT_CHALLENGE_QUESTIONS));
    }
}

function saveChallengeQuestions(newQuestions) {
    const normalized = normalizeChallengeQuestions(newQuestions);
    if (!normalized) return false;
    localStorage.setItem(CHALLENGE_QUESTIONS_KEY, JSON.stringify(normalized));
    challengeQuestions = normalized;
    return true;
}

// الأسئلة الحالية المستخدمة في وضع التحدي
let challengeQuestions = loadChallengeQuestions();

// متغيرات نظام التحدي
let challengeQuestionsData = [];
let currentChallengeIndex = 0;
let challengeAnswers = {};
let challengeTimerInterval = null;
let challengeTimeRemaining = 300; // 5 دقائق
let challengeStartTime = null;
let challengerName = '';
let challengeResults = [];

// قائمة الكلمات الممنوعة
const bannedWords = [
    'كس', 'طيز', 'زب', 'شرموط', 'عرص', 'متناك', 'منيك', 'لبوه', 'قحب', 'عاهر',
    'خول', 'ابن الكلب', 'ابن الحرام', 'ابن العرص', 'ابن الشرموطه', 'كسم',
    'احا', 'ينعل', 'يلعن', 'زانيه', 'زاني', 'فاجر', 'فاجره', 'وسخ', 'وسخه',
    'حمار', 'غبي', 'احمق', 'معفن', 'قذر', 'نجس', 'حقير', 'تافه', 'واطي',
    'كلب', 'خنزير', 'حيوان', 'بهيم', 'ديوث', 'قواد',
    'fuck', 'shit', 'bitch', 'ass', 'dick', 'pussy', 'bastard', 'whore',
    'slut', 'cunt', 'cock', 'damn', 'hell', 'nigger', 'fag', 'gay',
    'stupid', 'idiot', 'dumb', 'retard', 'loser', 'sucker', 'motherfucker',
    'ابليس', 'شيطان', 'satan', 'devil', 'demon'
];



// =====================
// نظام اسم المستخدم (يتم طلبه أول مرة ثم يُستخدم تلقائياً داخل المنصة والامتحانات)
// =====================

const ANON_USER_NAME = 'مجهول';

const USER_FIRST_NAME_KEY_BASE = 'spacePlatform_firstName_v2';
const USER_DATA_KEY_BASE = 'spacePlatform_userData_v2';
const FIRESTORE_ATTEMPTS_COLLECTION = 'examAttempts_v1';
const FIRESTORE_USERS_COLLECTION = 'users_v1';

function getCurrentUidOrAnon() {
    return String(appData?.firebaseUser?.uid || 'anon');
}

function getFirstNameStorageKey() {
    return `${USER_FIRST_NAME_KEY_BASE}_${getCurrentUidOrAnon()}`;
}

function getUserDataStorageKey() {
    return `${USER_DATA_KEY_BASE}_${getCurrentUidOrAnon()}`;
}


// =====================
// Firebase Auth + User Profiles (Firestore)
// =====================

function isAuthReady() {
    return !!(window.firebaseAuth && window.authApi);
}

function isCurrentUserAdminRole() {
    return String(appData?.currentRole || 'student').toLowerCase() === 'admin';
}

function setElDisplay(el, show, displayValue = 'inline-flex') {
    if (!el) return;
    el.style.display = show ? displayValue : 'none';
}

function showAuthModal(message, opts = {}) {
    const modal = document.getElementById('authModal');
    const statusEl = document.getElementById('authStatusText');
    const resendBtn = document.getElementById('resendVerificationBtn');
    const checkBtn = document.getElementById('checkVerificationBtn');

    if (statusEl) statusEl.innerHTML = message || 'سجّل دخولك لمتابعة المنصة.';
    if (modal) modal.style.display = 'flex';

    setElDisplay(resendBtn, !!opts.showResend, 'inline-flex');
    setElDisplay(checkBtn, !!opts.showCheck, 'inline-flex');
}

function hideAuthModal() {
    const modal = document.getElementById('authModal');
    if (modal) modal.style.display = 'none';
}

function setMainPlatformVisible(isVisible) {
    const mainPlatform = document.getElementById('mainPlatform');
    if (mainPlatform) mainPlatform.style.display = isVisible ? 'block' : 'none';
}

let __authUiBound = false;
let __adminUsersUnsub = null;
let __adminAttemptsUnsub = null;

function bindAuthUiOnce() {
    if (__authUiBound) return;
    __authUiBound = true;

    const googleBtn = document.getElementById('googleSignInBtn');
    const signUpBtn = document.getElementById('emailSignUpBtn');
    const signInBtn = document.getElementById('emailSignInBtn');
    const resendBtn = document.getElementById('resendVerificationBtn');
    const checkBtn = document.getElementById('checkVerificationBtn');

    if (googleBtn) googleBtn.addEventListener('click', handleGoogleSignIn);
    if (signUpBtn) signUpBtn.addEventListener('click', handleEmailSignUp);
    if (signInBtn) signInBtn.addEventListener('click', handleEmailSignIn);
    if (resendBtn) resendBtn.addEventListener('click', handleResendVerification);
    if (checkBtn) checkBtn.addEventListener('click', handleCheckVerification);
}

function getAuthEmailPassword() {
    const email = String(document.getElementById('authEmail')?.value || '').trim();
    const password = String(document.getElementById('authPassword')?.value || '').trim();
    return { email, password };
}

function getPrimaryProviderId(user) {
    try {
        const p = user?.providerData?.[0]?.providerId || '';
        return String(p);
    } catch {
        return '';
    }
}

function needsEmailVerification(user) {
    // Google accounts are already verified by Google
    const providers = (user?.providerData || []).map(p => p.providerId);
    const hasPassword = providers.includes('password');
    return hasPassword && !user?.emailVerified;
}

function providerLabelFromId(providerId) {
    if (providerId === 'google.com') return 'Google';
    if (providerId === 'password') return 'Email/Password';
    return providerId || 'غير معروف';
}

async function waitForFirebaseReady(maxWaitMs = 15000) {
    const start = Date.now();
    return new Promise((resolve, reject) => {
        const tick = () => {
            if (isAuthReady() && isFirestoreReady()) return resolve(true);
            if (Date.now() - start > maxWaitMs) return reject(new Error('Firebase لم يكتمل تحميله.'));
            setTimeout(tick, 100);
        };
        tick();
    });
}

async function initAuthSystem() {
    // Hide until auth
    setMainPlatformVisible(false);
    bindAuthUiOnce();

    // Hide admin buttons by default
    applyRoleVisibilityToUI();

    // Wait for firebase
    try {
        await waitForFirebaseReady();
    } catch (e) {
        console.error(e);
        showAuthModal('حدث خطأ في تحميل Firebase. تأكد من إعدادات المشروع.');
        return;
    }

    const authApi = window.authApi;
    const auth = window.firebaseAuth;

    // في حالة تم استخدام signInWithRedirect (مفيد للموبايل/الويب فيو)، خلّص النتيجة بصمت
    try {
        if (authApi && typeof authApi.getRedirectResult === 'function') {
            await authApi.getRedirectResult(auth);
        }
    } catch (e) {
        console.warn('Redirect sign-in result error:', e);
    }

    const { onAuthStateChanged } = authApi;

    onAuthStateChanged(auth, async (user) => {
        try {
            await handleAuthStateChanged(user);
        } catch (e) {
            console.error(e);
            showAlert('حصل خطأ أثناء تسجيل الدخول.', 'error');
            showAuthModal('حصل خطأ أثناء تسجيل الدخول. حاول مرة تانية.');
        }
    });

    // زر الخروج (في الهيدر)
    const logoutBtn = document.getElementById('logoutNavBtn');
    if (logoutBtn && !logoutBtn.__bound) {
        logoutBtn.__bound = true;
        logoutBtn.addEventListener('click', logoutUser);
    }
}

async function logoutUser() {
    if (!isAuthReady()) return;
    const { signOut } = window.authApi;
    try {
        await signOut(window.firebaseAuth);
    } catch (e) {
        console.error(e);
        showAlert('مش قادر أسجّل خروج دلوقتي.', 'error');
    }
}

async function handleGoogleSignIn() {
    if (!isAuthReady()) return;

    const { GoogleAuthProvider, signInWithPopup, signInWithRedirect } = window.authApi;
    const auth = window.firebaseAuth;

    try {
        showAuthModal('جاري تسجيل الدخول...');
        const provider = new GoogleAuthProvider();

        try {
            await signInWithPopup(auth, provider);
        } catch (e) {
            // بعض الأجهزة/المتصفحات (خصوصاً الموبايل أو داخل WebView) بتفشل الـ Popup
            const code = String(e?.code || '');
            const msg = String(e?.message || '').toLowerCase();

            const shouldRedirect =
                code.includes('popup') ||
                code.includes('operation-not-supported') ||
                code.includes('web-storage-unsupported') ||
                msg.includes('popup');

            if (shouldRedirect && typeof signInWithRedirect === 'function') {
                // هتعمل Redirect وتكمل تلقائياً بعد الرجوع
                await signInWithRedirect(auth, provider);
                return;
            }

            throw e;
        }

        // onAuthStateChanged will handle the rest
    } catch (e) {
        console.error(e);
        showAlert('فشل تسجيل الدخول بجوجل. حاول تاني.', 'error');
        showAuthModal('فشل تسجيل الدخول بجوجل. حاول تاني.');
    }
}

async function handleEmailSignUp() {
    if (!isAuthReady()) return;
    const { email, password } = getAuthEmailPassword();
    if (!email || !password) {
        showAlert('اكتب الإيميل وكلمة المرور.', 'error');
        return;
    }

    const { createUserWithEmailAndPassword, sendEmailVerification, signOut } = window.authApi;
    const auth = window.firebaseAuth;

    try {
        showAuthModal('جاري إنشاء الحساب...');
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        try {
            await sendEmailVerification(cred.user);
        } catch (e) {
            console.warn('sendEmailVerification failed', e);
        }

try {
            await ensureUserProfile(cred.user);
        } catch (e) {
            // ignore
        }

        showAlert('تم إنشاء الحساب! هتوصلك رسالة تفعيل على الإيميل.', 'success');
        await signOut(auth);
        showAuthModal('تم إنشاء الحساب ✅<br>من فضلك فعّل بريدك من الرسالة اللي وصلت لك، وبعدها سجّل دخول.', { showResend: false, showCheck: false });
    } catch (e) {
        console.error(e);
        showAlert('فشل إنشاء الحساب. تأكد من البيانات.', 'error');
        showAuthModal('فشل إنشاء الحساب. تأكد من البيانات وحاول تاني.');
    }
}

async function handleEmailSignIn() {
    if (!isAuthReady()) return;
    const { email, password } = getAuthEmailPassword();
    if (!email || !password) {
        showAlert('اكتب الإيميل وكلمة المرور.', 'error');
        return;
    }

    const { signInWithEmailAndPassword } = window.authApi;
    const auth = window.firebaseAuth;

    try {
        showAuthModal('جاري تسجيل الدخول...');
        await signInWithEmailAndPassword(auth, email, password);
        // onAuthStateChanged will handle gating
    } catch (e) {
        console.error(e);
        showAlert('فشل تسجيل الدخول. تأكد من البيانات.', 'error');
        showAuthModal('فشل تسجيل الدخول. تأكد من البيانات وحاول تاني.');
    }
}

async function handleResendVerification() {
    if (!isAuthReady()) return;
    const { sendEmailVerification } = window.authApi;
    const user = window.firebaseAuth?.currentUser;
    if (!user) return;

    try {
        await sendEmailVerification(user);
        showAlert('تم إرسال رسالة تفعيل جديدة ✅', 'success');
    } catch (e) {
        console.error(e);
        showAlert('مش قادر أبعت رسالة تفعيل دلوقتي.', 'error');
    }
}

async function handleCheckVerification() {
    if (!isAuthReady()) return;
    const { reload } = window.authApi;
    const user = window.firebaseAuth?.currentUser;
    if (!user) return;

    try {
        await reload(user);
        if (user.emailVerified) {
            hideAuthModal();
            showAlert('تم التفعيل ✅', 'success');
            // force refresh of state
            await handleAuthStateChanged(user);
        } else {
            showAlert('لسه ما اتفعلش. جرّب تاني بعد ما تفتح رسالة التفعيل.', 'info');
        }
    } catch (e) {
        console.error(e);
        showAlert('تعذر التحقق من التفعيل.', 'error');
    }
}

async function ensureUserProfile(user) {
    if (!isFirestoreReady() || !user) return null;

    const db = window.firestoreDb;
    const api = window.firestoreApi;

    const now = Date.now();
    const uid = user.uid;
    const ref = api.doc(db, FIRESTORE_USERS_COLLECTION, uid);

    let profile = null;
    try {
        const snap = await api.getDoc(ref);
        if (!snap.exists()) {
            const localName = getSavedFirstName();
            const displayName = String(user.displayName || localName || '').trim();

            profile = {
                uid,
                email: String(user.email || ''),
                displayName,
                role: 'student',
                providerId: getPrimaryProviderId(user),
                emailVerified: !!user.emailVerified,
                createdAtMs: now,
                lastLoginAtMs: now,
                lastSeenMs: now,
                currentExam: null,
                lastExam: null
            };

            await api.setDoc(ref, profile);
        } else {
            profile = snap.data() || {};
            const patch = {
                email: String(user.email || profile.email || ''),
                providerId: profile.providerId || getPrimaryProviderId(user),
                emailVerified: !!user.emailVerified,
                lastLoginAtMs: now,
                lastSeenMs: now
            };

            // لو الاسم ناقص، استخدم اللي في localStorage أو من auth
            const localName = getSavedFirstName();
            const currentName = String(profile.displayName || '').trim();
            const authName = String(user.displayName || '').trim();
            const bestName = currentName || localName || authName;
            if (bestName && bestName !== currentName) {
                patch.displayName = bestName;
            }

            await api.setDoc(ref, patch, { merge: true });
            profile = { ...profile, ...patch };
        }
    } catch (e) {
        console.error('ensureUserProfile failed', e);
        profile = null;
    }

    // Cache
    appData.userProfile = profile;
    appData.currentRole = String(profile?.role || 'student');

    // Sync name to localStorage
    if (profile?.displayName) {
        setSavedFirstName(profile.displayName);
    }

    // Listen for profile changes (role updates)
    try {
        if (appData._profileUnsub) {
            appData._profileUnsub();
            appData._profileUnsub = null;
        }
        appData._profileUnsub = api.onSnapshot(ref, (snap) => {
            if (!snap.exists()) return;
            const data = snap.data() || {};
            appData.userProfile = data;
            appData.currentRole = String(data.role || 'student');
            if (data.displayName) setSavedFirstName(String(data.displayName));
            applyRoleVisibilityToUI();
        });
    } catch (e) {
        // ignore
    }

    return profile;
}

function applyRoleVisibilityToUI() {
    const settingsNavBtn = document.getElementById('settingsNavBtn');
    const heroSettingsBtn = document.getElementById('heroSettingsBtn');
    const logoutBtn = document.getElementById('logoutNavBtn');

    const signedIn = !!appData?.firebaseUser;
    setElDisplay(logoutBtn, signedIn, 'inline-flex');

    const isAdmin = isCurrentUserAdminRole();
    setElDisplay(settingsNavBtn, signedIn && isAdmin, 'inline-flex');
    setElDisplay(heroSettingsBtn, signedIn && isAdmin, 'inline-flex');
}

async function updateUserPresenceTick() {
    if (!isFirestoreReady() || !appData.firebaseUser) return;
    const db = window.firestoreDb;
    const api = window.firestoreApi;

    try {
        const ref = api.doc(db, FIRESTORE_USERS_COLLECTION, appData.firebaseUser.uid);
        await api.setDoc(ref, {
            lastSeenMs: Date.now(),
            emailVerified: !!appData.firebaseUser.emailVerified
        }, { merge: true });
    } catch (e) {
        // ignore
    }
}

function startPresenceLoop() {
    stopPresenceLoop();
    updateUserPresenceTick();
    appData._presenceInterval = setInterval(updateUserPresenceTick, 30000);

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') updateUserPresenceTick();
    }, { passive: true });
}

function stopPresenceLoop() {
    if (appData._presenceInterval) {
        clearInterval(appData._presenceInterval);
        appData._presenceInterval = null;
    }
}

async function setUserCurrentExam(patch) {
    if (!isFirestoreReady() || !appData.firebaseUser) return;
    const db = window.firestoreDb;
    const api = window.firestoreApi;

    try {
        const ref = api.doc(db, FIRESTORE_USERS_COLLECTION, appData.firebaseUser.uid);
        await api.setDoc(ref, { ...patch, lastSeenMs: Date.now() }, { merge: true });
    } catch (e) {
        // ignore
    }
}

function markExamStartedFirestore(mode, subject, difficulty) {
    const payload = {
        currentExam: {
            mode: String(mode || ''),
            subject: String(subject || ''),
            difficulty: String(difficulty || ''),
            status: 'in_progress',
            startedAtMs: Date.now()
        }
    };
    setUserCurrentExam(payload);
}

function markExamFinishedFirestore(mode, subject, difficulty, percent, passed) {
    const payload = {
        currentExam: null,
        lastExam: {
            mode: String(mode || ''),
            subject: String(subject || ''),
            difficulty: String(difficulty || ''),
            percent: Number(percent || 0),
            passed: !!passed,
            endedAtMs: Date.now()
        }
    };
    setUserCurrentExam(payload);
}

async function handleAuthStateChanged(user) {
    // cleanup
    appData.firebaseUser = user || null;

    if (!user) {
        stopPresenceLoop();
        applyRoleVisibilityToUI();
        setMainPlatformVisible(false);
        showAuthModal('سجّل دخولك لمتابعة المنصة.');
        return;
    }

    // Gate for email verification (email/password only)
    if (needsEmailVerification(user)) {
        applyRoleVisibilityToUI();
        setMainPlatformVisible(false);
        showAuthModal('لازم تفعّل بريدك الإلكتروني أولاً ✅<br>افتح رسالة التفعيل على الإيميل، وبعدها اضغط "تحقّق من التفعيل".', {
            showResend: true,
            showCheck: true
        });
        return;
    }

    // Ensure profile exists & read role
    await ensureUserProfile(user);

    // Load local data per user
    if (typeof loadUserData === 'function') {
        loadUserData();
    }

    // Ensure we have a usable display name (ask once فقط)
    const profileName = String(appData.userProfile?.displayName || '').trim();
    const localName = getSavedFirstName();
    const authName = String(user.displayName || '').trim();
    const currentName = profileName || localName || authName;

    if (!currentName) {
        // ask once
        openNameModal(() => {
            // will update on save inside verifyFirstNameAndContinue
            applyRoleVisibilityToUI();
        });
    } else {
        // خزن الاسم محلياً حتى لو Firestore مش متاح (عشان ما يطلبوش تاني)
        if (currentName !== localName) setSavedFirstName(currentName);

        // لو Firestore موجود لكن البروفايل مفيهوش اسم، اعمله Sync (غير مُعطّل للتجربة)
        if (!profileName && isFirestoreReady() && appData.firebaseUser) {
            (async () => {
                try {
                    const api = window.firestoreApi;
                    const db = window.firestoreDb;
                    const ref = api.doc(db, FIRESTORE_USERS_COLLECTION, appData.firebaseUser.uid);
                    await api.setDoc(ref, {
                        displayName: currentName,
                        email: String(appData.firebaseUser.email || ''),
                        emailVerified: !!appData.firebaseUser.emailVerified,
                        lastSeenMs: Date.now(),
                        lastLoginAtMs: Date.now(),
                        providerId: getPrimaryProviderId(appData.firebaseUser)
                    }, { merge: true });
                } catch (e) {
                    // ignore
                }
            })();
        }
    }

    // sync current user object name if needed
    ensureCurrentUserObject();
    if (currentName) {
        appData.currentUser.name = currentName;
        saveCurrentUserData();
    }

    // Ready
    hideAuthModal();
    setMainPlatformVisible(true);
    applyRoleVisibilityToUI();
    try { initChallengeQuestionsSync(); } catch (e) {}
    try { initExamDurationsSync(); } catch (e) {}
    startPresenceLoop();
}


function getSavedFirstName() {
    return String(localStorage.getItem(getFirstNameStorageKey()) || '').trim();
}

function setSavedFirstName(firstName) {
    const clean = String(firstName || '').trim();
    if (!clean) return;

    localStorage.setItem(getFirstNameStorageKey(), clean);

    ensureCurrentUserObject();
    appData.currentUser.name = clean;

    try {
        saveCurrentUserData();
    } catch (e) {
        // تجاهل
    }

    try { applyUserNameToUI(); } catch (e) {}
}

function getEffectiveUserName() {
    const saved = getSavedFirstName();
    if (saved) return saved;

    const current = String(appData.currentUser?.name || '').trim();
    if (current && current !== ANON_USER_NAME) return current;

    return '';
}

// نافذة الاسم
let pendingNameCallback = null;

function openNameModal(onDone) {
    pendingNameCallback = typeof onDone === 'function' ? onDone : null;

    const modal = document.getElementById('nameModal');
    const input = document.getElementById('firstNameInput');

    if (!modal || !input) {
        // fallback بسيط
        const raw = prompt('اكتب اسمك:');
        if (!raw) return;

        const full = String(raw).trim();
        const filtered = filterName(full);
        if (!filtered) {
            showAlert('الاسم غير مناسب. اكتب اسم صحيح بحروف فقط (مع مسافات) بدون أرقام/رموز.', 'error');
            return;
        }
        setSavedFirstName(filtered);
        if (pendingNameCallback) {
            const cb = pendingNameCallback;
            pendingNameCallback = null;
            cb();
        }
        return;
    }

    modal.style.display = 'flex';
    input.value = '';
    setTimeout(() => input.focus(), 80);
}

function verifyFirstNameAndContinue() {
    const input = document.getElementById('firstNameInput');
    const raw = String(input?.value || '').trim();

    if (!raw) {
        showAlert('من فضلك اكتب اسمك.', 'error');
        input?.focus();
        return;
    }

    const filtered = filterName(raw);

    if (!filtered) {
        showAlert('الاسم غير مناسب. استخدم حروف فقط (عربي/إنجليزي) مع مسافات، بدون أرقام/رموز.', 'error');
        input?.select?.();
        return;
    }

    // حفظ الاسم محلياً (مفتاح خاص بالمستخدم)
    setSavedFirstName(filtered);

    // تحديث كائن المستخدم المحلي (للاختبارات/النقاط)
    ensureCurrentUserObject();
    appData.currentUser.name = filtered;
    saveCurrentUserData();

    // لو المستخدم مسجل دخول بـ Firebase: خزّن الاسم في Firestore و Auth displayName
    (async () => {
        try {
            if (isAuthReady() && isFirestoreReady() && appData.firebaseUser) {
                const { updateProfile } = window.authApi;
                const authUser = window.firebaseAuth?.currentUser;
                if (authUser) {
                    try { await updateProfile(authUser, { displayName: filtered }); } catch (e) {}
                }

                const api = window.firestoreApi;
                const db = window.firestoreDb;
                const ref = api.doc(db, FIRESTORE_USERS_COLLECTION, appData.firebaseUser.uid);
                await api.setDoc(ref, { displayName: filtered, lastSeenMs: Date.now(), email: String(appData.firebaseUser.email || ''), emailVerified: !!appData.firebaseUser.emailVerified }, { merge: true });
            }
        } catch (e) {
            console.warn('Failed to sync displayName', e);
        }
    })();

    closeModal('nameModal');

    if (pendingNameCallback) {
        const cb = pendingNameCallback;
        pendingNameCallback = null;
        cb();
    }
}

function isFirestoreReady() {
    return !!(window.firestoreDb && window.firestoreApi);
}

async function saveAttemptToFirestore(attempt) {
    try {
        if (!isFirestoreReady()) return false;

        const api = window.firestoreApi;
        const db = window.firestoreDb;

        const uid = String(appData?.firebaseUser?.uid || '');
        const email = String(appData?.firebaseUser?.email || '');

        const payload = {
            ...attempt,
            uid: uid || undefined,
            email: email || undefined,
            createdAtMs: Date.now(),
            createdAt: api.serverTimestamp()
        };

        await api.addDoc(api.collection(db, FIRESTORE_ATTEMPTS_COLLECTION), payload);
        return true;
    } catch (err) {
        console.error('Firestore save failed:', err);
        return false;
    }
}

async function fetchLatestAttempts(maxItems = 200) {
    if (!isFirestoreReady()) return [];

    const api = window.firestoreApi;
    const db = window.firestoreDb;

    const q = api.query(
        api.collection(db, FIRESTORE_ATTEMPTS_COLLECTION),
        api.orderBy('createdAtMs', 'desc'),
        api.limit(Math.max(1, Math.min(500, maxItems)))
    );

    const snap = await api.getDocs(q);
    const out = [];
    snap.forEach(doc => out.push({ id: doc.id, ...doc.data() }));
    return out;
}

// (لا يوجد اسم مستخدم في الواجهة بعد الآن)
function applyUserNameToUI() {
    // intentionally empty
}

function ensureCurrentUserObject() {
    if (!appData.currentUser) {
        appData.currentUser = {
            name: ANON_USER_NAME,
            points: 0,
            exams: [],
            challenges: [],
            joinDate: new Date().toLocaleDateString('ar-EG'),
            level: 'مبتدئ'
        };
    }

    if (!Array.isArray(appData.currentUser.exams)) appData.currentUser.exams = [];
    if (!Array.isArray(appData.currentUser.challenges)) appData.currentUser.challenges = [];
    if (typeof appData.currentUser.points !== 'number') appData.currentUser.points = parseInt(appData.currentUser.points, 10) || 0;
    if (!appData.currentUser.joinDate) appData.currentUser.joinDate = new Date().toLocaleDateString('ar-EG');
    if (!appData.currentUser.level) appData.currentUser.level = 'مبتدئ';

    // تحميل الاسم المحفوظ (الاسم الأول) إن وجد
    const savedFirstName = getSavedFirstName();
    if (savedFirstName) {
        appData.currentUser.name = savedFirstName;
    } else {
        // fallback
        if (!appData.currentUser.name) appData.currentUser.name = ANON_USER_NAME;
    }
}

// بدء الرحلة (موجودة للتوافق فقط - بدون تسجيل أسماء)
function startJourney() {
    ensureCurrentUserObject();
    loadUserData();
}

// تغيير/تحديث الاسم (تم تعطيلها)
function changeUserName() {}
function updateUserName() {}

// =====================
// إعدادات مدة الامتحان (العد التنازلي)
// =====================
function initDurationSettingsUI() {
    // تحديث عرض مدة التحدي في الواجهة
    const challengeMinutes = Math.round(getChallengeDurationSeconds() / 60);
    document.querySelectorAll('.challengeDurationLabel').forEach(el => {
        el.textContent = String(challengeMinutes);
    });

    // تحديث قيمة المدخلات داخل الإعدادات
    const chInput = document.getElementById('challengeDurationMinutes');
    const quickInput = document.getElementById('quickExamDurationMinutes');
    if (chInput) chInput.value = String(challengeMinutes);
    if (quickInput) quickInput.value = String(Math.round(getQuickExamDurationSeconds() / 60));

    // تحديث عرض المؤقت لو التحدي مش شغال
    const timerDisplay = document.getElementById('timerDisplay');
    const challengeContainer = document.getElementById('challengeContainer');
    if (timerDisplay && challengeContainer && challengeContainer.style.display === 'none') {
        timerDisplay.textContent = formatMMSS(getChallengeDurationSeconds());
    }
}

async function saveExamDurations() {
    if (!requireAdminForChallengeEdit()) return;

    const ch = document.getElementById('challengeDurationMinutes');
    const q = document.getElementById('quickExamDurationMinutes');
    const subj = document.getElementById('challengeSubjectNameInput');

    const chMin = clampInt(ch?.value, 1, 60, Math.round(DEFAULT_CHALLENGE_DURATION_SECONDS / 60));
    const qMin = clampInt(q?.value, 1, 60, Math.round(DEFAULT_QUICK_EXAM_DURATION_SECONDS / 60));

    const chSeconds = chMin * 60;
    const qSeconds = qMin * 60;

    // حفظ محلي (LocalStorage)
    setChallengeDurationSeconds(chSeconds);
    setQuickExamDurationSeconds(qSeconds);

    // مشاركة مدة الامتحان/التحدي على Firestore (عشان كل المستخدمين تتحدث عندهم)
    const okDur = await saveExamDurationsToFirestore({ challengeSeconds: chSeconds, quickSeconds: qSeconds });

    // حفظ اسم مادة التحدي (اختياري)
    let okSubj = true;
    const rawSubject = String(subj?.value || '').trim();
    if (rawSubject) {
        const cleanSubject = filterSubjectName(rawSubject);
        if (!cleanSubject) {
            showAlert('اسم مادة التحدي غير مناسب. استخدم حروف/أرقام فقط مع مسافات، وبدون رموز غريبة.', 'error');
            subj?.focus?.();
            subj?.select?.();
            return;
        }
        setChallengeSubjectName(cleanSubject);
        okSubj = await saveChallengeSubjectNameToFirestore(cleanSubject);
    } else {
        // لو فاضي: رجوع للافتراضي
        setChallengeSubjectName('');
        okSubj = await saveChallengeSubjectNameToFirestore(DEFAULT_CHALLENGE_SUBJECT_NAME);
    }

    initDurationSettingsUI();
    applyChallengeSubjectNameToUI();

    if (okDur && okSubj) {
        showAlert('تم حفظ الإعدادات ✅', 'success');
    } else {
        showAlert('تم حفظ الإعدادات محلياً ✅ (تعذر المزامنة على Firebase - راجع Firestore Rules/الاتصال)', 'info');
    }
}

// تهيئة النجوم المتحركة
function initStars() {
    console.log("النجوم الفضائية جاهزة للانطلاق! 🚀");
}

// إغلاق النافذة المنبثقة
function closeModal(modalId) {
    document.getElementById(modalId).style.display = 'none';
}

// تحميل بيانات المستخدم
function loadUserData() {
    const key = getUserDataStorageKey();

    // هجرة بيانات قديمة (لو موجودة قبل إضافة تسجيل الدخول)
    const legacy = localStorage.getItem('spacePlatform_userData');
    const savedData = localStorage.getItem(key) || legacy;

    try {
        if (savedData) {
            appData.currentUser = JSON.parse(savedData);
        }
    } catch (e) {
        appData.currentUser = null;
    }

    ensureCurrentUserObject();

    // حفظ نسخة سليمة في المفتاح الجديد
    saveCurrentUserData();

    // تحميل نتائج الامتحانات السابقة
    loadPreviousResults();
}

function saveCurrentUserData() {
    try {
        localStorage.setItem(getUserDataStorageKey(), JSON.stringify(appData.currentUser));
    } catch (e) {
        // ignore
    }
}

// تحميل لوحة المتصدرين
function loadLeaderboard() {
    // تحميل من localStorage أو استخدام بيانات افتراضية
    const savedLeaderboard = localStorage.getItem('spacePlatform_leaderboard');
    
    if (savedLeaderboard) {
        appData.leaderboard = JSON.parse(savedLeaderboard);
    } else {
        // بيانات افتراضية للمتصدرين
        appData.leaderboard = [
            { name: 'أحمد محمود', subject: 'physics', points: 920, level: 'خبير', date: '2025-01-15' },
            { name: 'محمد أحمد', subject: 'math', points: 850, level: 'متقدم', date: '2025-01-14' },
            { name: 'سارة خالد', subject: 'programming', points: 810, level: 'متقدم', date: '2025-01-13' },
            { name: 'خالد حسين', subject: 'networks', points: 780, level: 'متوسط', date: '2025-01-12' },
            { name: 'فاطمة علي', subject: 'physics', points: 750, level: 'متوسط', date: '2025-01-11' },
            { name: 'عمر سعيد', subject: 'math', points: 720, level: 'متوسط', date: '2025-01-10' },
            { name: 'لينا محسن', subject: 'programming', points: 690, level: 'مبتدئ', date: '2025-01-09' },
            { name: 'يوسف كمال', subject: 'networks', points: 650, level: 'مبتدئ', date: '2025-01-08' },
            { name: 'نور محمد', subject: 'physics', points: 620, level: 'مبتدئ', date: '2025-01-07' },
            { name: 'مريم أسامة', subject: 'math', points: 580, level: 'مبتدئ', date: '2025-01-06' }
        ];
    }
    
    updateLeaderboardDisplay();
}

// الحصول على اسم المادة
function getSubjectName(subjectCode) {
    const subjects = {
        'physics': 'الفيزياء',
        'math': 'الرياضيات',
        'electronics': 'الإلكترونيات',
        'computing-laws': 'قوانين الحوسبة',
        'computing-history': 'تاريخ الحوسبة',
        'english': 'الإنجليزية',
        'math-zero': 'ماث زيرو',
        'it': 'IT',
        'all': 'جميع المواد'
    };
    
    return subjects[subjectCode] || subjectCode;
}

// تحديث عرض لوحة المتصدرين
function updateLeaderboardDisplay() {
    // تحديث المراكز الثلاثة الأولى
    if (appData.leaderboard.length > 0) {
        document.getElementById('firstName').textContent = appData.leaderboard[0].name;
        document.getElementById('firstScore').textContent = appData.leaderboard[0].points + ' نقطة';
        
        if (appData.leaderboard.length > 1) {
            document.getElementById('secondName').textContent = appData.leaderboard[1].name;
            document.getElementById('secondScore').textContent = appData.leaderboard[1].points + ' نقطة';
        }
        
        if (appData.leaderboard.length > 2) {
            document.getElementById('thirdName').textContent = appData.leaderboard[2].name;
            document.getElementById('thirdScore').textContent = appData.leaderboard[2].points + ' نقطة';
        }
    }
    
    // تحديث موقع المستخدم الحالي
    updateUserPosition();
}

// تحديث موقع المستخدم الحالي في اللوحة
function updateUserPosition() {
    if (!appData.currentUser) return;
    
    const userPosition = appData.leaderboard.findIndex(entry => entry.name === appData.currentUser.name);
    const userEntry = appData.leaderboard[userPosition];
    
    if (userPosition >= 0 && userEntry) {
        document.querySelector('.position-rank').textContent = `#${userPosition + 1}`;
        document.querySelector('.position-name').textContent = userEntry.name;
        document.querySelector('.position-score').textContent = userEntry.points + ' نقطة';
        document.querySelector('.position-level').textContent = userEntry.level;
    } else {
        // المستخدم ليس في اللوحة بعد
        document.querySelector('.position-rank').textContent = '#--';
        document.querySelector('.position-name').textContent = appData.currentUser.name;
        document.querySelector('.position-score').textContent = appData.currentUser.points + ' نقطة';
        document.querySelector('.position-level').textContent = 'مبتدئ';
    }
}

// تحديث إدخال المستخدم في لوحة المتصدرين
function updateLeaderboardEntry() {
    if (!appData.currentUser) return;
    
    // البحث عن المستخدم الحالي في اللوحة
    const userIndex = appData.leaderboard.findIndex(entry => entry.name === appData.currentUser.name);
    
    const userEntry = {
        name: appData.currentUser.name,
        subject: 'all',
        points: appData.currentUser.points,
        level: appData.currentUser.level,
        date: new Date().toLocaleDateString('ar-EG')
    };
    
    if (userIndex >= 0) {
        // تحديث الإدخال الحالي
        appData.leaderboard[userIndex] = userEntry;
    } else {
        // إضافة إدخال جديد
        appData.leaderboard.push(userEntry);
    }
    
    // ترتيب اللوحة حسب النقاط (تنازلياً)
    appData.leaderboard.sort((a, b) => b.points - a.points);
    
    // حفظ اللوحة المحدثة
    localStorage.setItem('spacePlatform_leaderboard', JSON.stringify(appData.leaderboard));
    
    // تحديث العرض
    updateLeaderboardDisplay();
}

// تصفية لوحة المتصدرين
function filterLeaderboard(filter) {
    // في النسخة البسيطة، نقوم فقط بتغيير النمط للأزرار
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    
    event.target.classList.add('active');
    
    showAlert(`تم عرض المتصدرين: ${filter === 'all' ? 'الكل' : filter === 'week' ? 'هذا الأسبوع' : 'هذا الشهر'}`, 'info');
}

// تحديث إحصائيات المستخدم
function updateUserStats() {
    // تم إلغاء لوحة المتصدرين — نحتفظ فقط بتحديث المستوى/النتائج لو احتجنا
    try {
        updateUserLevel();
    } catch (e) {}
}

// تحميل نتائج الامتحانات السابقة
function loadPreviousResults() {
    if (!appData.currentUser || !appData.currentUser.exams) return;
    
    const resultsList = document.getElementById('resultsList');
    resultsList.innerHTML = '';
    
    // عرض آخر 5 نتائج فقط
    const recentExams = appData.currentUser.exams.slice(-5).reverse();
    
    if (recentExams.length === 0) {
        resultsList.innerHTML = `
            <div class="no-results">
                <i class="fas fa-inbox"></i>
                <p>لا توجد نتائج سابقة. ابدأ اختبارك الأول الآن!</p>
            </div>
        `;
        return;
    }
    
    recentExams.forEach(exam => {
        const examDate = new Date(exam.timestamp).toLocaleDateString('ar-EG');
        const accuracy = Math.round((exam.correctAnswers / exam.totalQuestions) * 100);
        
        const resultItem = document.createElement('div');
        resultItem.className = 'result-item';
        resultItem.innerHTML = `
            <div class="result-info">
                <h4>${getSubjectName(exam.subject)} - ${exam.type === 'quick' ? 'سريع' : exam.type === 'challenge' ? 'تحدي' : 'كامل'}</h4>
                <p>${examDate} | ${exam.difficulty === 'all' ? 'جميع المستويات' : exam.difficulty}</p>
            </div>
            <div class="result-score">${accuracy}%</div>
        `;
        
        resultsList.appendChild(resultItem);
    });
}

// إظهار قسم معين وإخفاء الآخرين
function showSection(sectionId) {
    // حماية صفحة الإعدادات للأدمن فقط
    if (sectionId === 'settings' && !isCurrentUserAdminRole()) {
        showAlert('صفحة الإعدادات للأدمن فقط.', 'error');
        return;
    }

    // تحديث الأزرار النشطة
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    
    // إضافة النشط للزر المناسب
    const activeBtn = Array.from(document.querySelectorAll('.nav-btn')).find(btn => 
        btn.textContent.includes(getSectionName(sectionId))
    );
    
    if (activeBtn) {
        activeBtn.classList.add('active');
    }
    
    // إخفاء جميع الأقسام
    document.querySelectorAll('.platform-section').forEach(section => {
        section.classList.remove('active');
    });
    
    // إظهار القسم المطلوب
    const targetSection = document.getElementById(sectionId + 'Section');
    if (!targetSection) {
        console.warn(`Section not found: ${sectionId}Section`);
        return;
    }
    targetSection.classList.add('active');
    appData.currentSection = sectionId;
    
    // إذا كان قسم المتصدرين، قم بتحديثه
    if (sectionId === 'leaderboard') {
        updateLeaderboardDisplay();
        updateUserStats();
        loadChallengeLeaderboard();
    }
    
    // إذا كان قسم النتائج، قم بتحميل النتائج
    if (sectionId === 'exams') {
        loadPreviousResults();
    }

    // إذا كان قسم الإعدادات
if (sectionId === 'settings') {
    updateAdminGateUI();
    updateSettingsVisibilityByAdmin();

    // لا يتم إظهار/تحميل بيانات الإعدادات إلا بعد باسورد الأدمن
    if (isAdminUnlocked()) {
        renderChallengeQuestionsEditor();
        initDurationSettingsUI();
    } else {
        const editor = document.getElementById('challengeQuestionsEditor');
        if (editor) editor.innerHTML = '';
    }
}
}

// الحصول على اسم القسم
function getSectionName(sectionId) {
    const sections = {
        'home': 'الرئيسية',
        'exams': 'الامتحانات',
        'settings': 'الإعدادات'
    };
    
    return sections[sectionId] || sectionId;
}

// =====================
// إعدادات أسئلة وضع التحدي
// =====================

let challengeQuestionsDraft = null;

// =====================
// قفل الأدمن لتعديل أسئلة التحدي (حماية محلية داخل المتصفح)
// =====================

const ADMIN_ACCESS_CODE = 'albtat@#10';
const ADMIN_UNLOCK_SESSION_KEY = 'spacePlatform_adminUnlocked_v1';

function isAdminUnlocked() {
    return sessionStorage.getItem(ADMIN_UNLOCK_SESSION_KEY) === '1';
}

function setAdminUnlocked(unlocked) {
    if (unlocked) {
        sessionStorage.setItem(ADMIN_UNLOCK_SESSION_KEY, '1');
    } else {
        sessionStorage.removeItem(ADMIN_UNLOCK_SESSION_KEY);
    }
}

/**
 * إظهار/إخفاء محتوى الإعدادات بالكامل حسب حالة الأدمن
 * (المطلوب: لا تظهر بيانات الإعدادات إلا بعد باسورد الأدمن)
 */
function updateSettingsVisibilityByAdmin() {
    const lockScreen = document.getElementById('settingsLockedScreen');
    const content = document.getElementById('settingsContent');
    const unlocked = isAdminUnlocked();

    if (lockScreen) lockScreen.style.display = unlocked ? 'none' : 'flex';
    if (content) content.style.display = unlocked ? 'block' : 'none';
}

function setChallengeEditingEnabled(enabled) {
    // تفعيل/تعطيل أزرار الإعدادات الثابتة
    document.querySelectorAll('[data-admin-edit="challenge"]').forEach(el => {
        try {
            el.disabled = !enabled;
        } catch (e) {}
    });

    const gateBar = document.getElementById('adminGateBar');
    if (gateBar) {
        gateBar.classList.toggle('locked', !enabled);
        gateBar.classList.toggle('unlocked', !!enabled);
    }

    const lockBtn = document.getElementById('adminGateLockBtn');
    if (lockBtn) {
        lockBtn.style.display = enabled ? 'inline-flex' : 'none';
    }
}

function updateAdminGateUI() {
    const unlocked = isAdminUnlocked();
    const status = document.getElementById('adminGateStatus');

    if (status) {
        if (unlocked) {
            status.innerHTML = `<i class="fas fa-unlock"></i> تم فتح الإعدادات للأدمن ✅`;
        } else {
            status.innerHTML = `<i class="fas fa-lock"></i> الإعدادات مقفولة - باسورد الأدمن مطلوب`;
        }
    }

    setChallengeEditingEnabled(unlocked);
    updateSettingsVisibilityByAdmin();
}

function openAdminAccessModal(force = false) {
    if (!isCurrentUserAdminRole()) {
        showAlert('للأدمن فقط.', 'error');
        return;
    }

    if (isAdminUnlocked() && !force) {
        updateAdminGateUI();
        return;
    }

    const modal = document.getElementById('adminAccessModal');
    if (!modal) return;

    modal.style.display = 'flex';

    const codeInput = document.getElementById('adminCodeInput');
    if (codeInput) {
        codeInput.value = '';
        setTimeout(() => codeInput.focus(), 50);
    }
}

function verifyAdminAccess() {
    const codeInput = document.getElementById('adminCodeInput');
    const code = String(codeInput?.value || '');

    if (!code) {
        showAlert('من فضلك اكتب باسورد الأدمن.', 'error');
        codeInput?.focus();
        return;
    }

    if (code !== ADMIN_ACCESS_CODE) {
        showAlert('باسورد الأدمن غير صحيح.', 'error');
        codeInput?.select?.();
        return;
    }

    setAdminUnlocked(true);
    closeModal('adminAccessModal');
    updateAdminGateUI();

    // تجهيز الإعدادات بعد الفتح
    renderChallengeQuestionsEditor();
    initDurationSettingsUI();

    showAlert('تم فتح الإعدادات ✅', 'success');
}
// =====================
// سجل الامتحانات (للأدمن) - يظهر بزرار فقط
// =====================

async function loadAdminAttempts(forceRefresh = false) {
    if (!isCurrentUserAdminRole()) {
        showAlert('للأدمن فقط.', 'error');
        return;
    }
    if (!isAdminUnlocked()) {
        showAlert('لازم تفتح الأدمن الأول.', 'error');
        return;
    }

    const container = document.getElementById('adminAttemptsContainer');
    const status = document.getElementById('adminAttemptsStatus');
    const tbody = document.getElementById('adminAttemptsTableBody');
    const refreshBtn = document.getElementById('adminRefreshAttemptsBtn');

    // Insights UI
    const insightsWrap = document.getElementById('adminAttemptsInsights');
    const insightsMeta = document.getElementById('adminAttemptsInsightsMeta');
    const top3List = document.getElementById('adminTop3List');
    const firstPeopleList = document.getElementById('adminFirstPeopleList');
    const firstHighlight = document.getElementById('adminFirstAttemptHighlight');

    if (!container || !status || !tbody) return;

    container.style.display = 'block';
    if (refreshBtn) refreshBtn.style.display = 'inline-flex';

    status.innerHTML = `<span class="loading"></span> جاري تحميل السجل...`;
    tbody.innerHTML = '';

    if (insightsWrap) insightsWrap.style.display = 'none';
    if (top3List) top3List.innerHTML = '';
    if (firstPeopleList) firstPeopleList.innerHTML = '';
    if (firstHighlight) firstHighlight.innerHTML = '—';
    if (insightsMeta) insightsMeta.textContent = '—';

    if (!isFirestoreReady()) {
        status.innerHTML = 'Firebase غير جاهز. تأكد إنك ضفت مكتبة Firestore في index.html وفعّلت Cloud Firestore في Firebase Console.';
        return;
    }

    const api = window.firestoreApi;
    const db = window.firestoreDb;

    // Unsubscribe previous live listener
    try {
        if (typeof __adminAttemptsUnsub === 'function') __adminAttemptsUnsub();
    } catch (e) {}
    __adminAttemptsUnsub = null;

    const formatDateTimeAr = (ms) => {
        if (!ms) return '—';
        try { return new Date(ms).toLocaleString('ar-EG'); } catch { return '—'; }
    };

    const formatScoreText = (it) => {
        if (typeof it.correctAnswers === 'number' && typeof it.totalQuestions === 'number') {
            return `${it.correctAnswers}/${it.totalQuestions}`;
        }
        const any = it.scorePoints ?? it.score;
        return (any === 0 || any) ? String(any) : '—';
    };

    const normalizePercent = (it) => {
        if (typeof it.percent === 'number' && Number.isFinite(it.percent)) return it.percent;
        if (typeof it.correctAnswers === 'number' && typeof it.totalQuestions === 'number' && it.totalQuestions > 0) {
            return Math.round((it.correctAnswers / it.totalQuestions) * 100);
        }
        return 0;
    };

    const safeCreatedAtMs = (it) => {
        const v = it?.createdAtMs;
        return (typeof v === 'number' && Number.isFinite(v)) ? v : Number.MAX_SAFE_INTEGER;
    };

    const updateInsights = (items) => {
        if (!insightsWrap || !top3List || !firstPeopleList || !firstHighlight) return;

        if (!Array.isArray(items) || items.length === 0) {
            insightsWrap.style.display = 'none';
            return;
        }

        // Top 3 by percent then correct then earliest
        const topSorted = [...items].sort((a, b) => {
            const pa = normalizePercent(a);
            const pb = normalizePercent(b);
            if (pb !== pa) return pb - pa;

            const sa = (typeof a.correctAnswers === 'number') ? a.correctAnswers : 0;
            const sb = (typeof b.correctAnswers === 'number') ? b.correctAnswers : 0;
            if (sb !== sa) return sb - sa;

            const da = (typeof a.durationSeconds === 'number') ? a.durationSeconds : Number.MAX_SAFE_INTEGER;
            const dbb = (typeof b.durationSeconds === 'number') ? b.durationSeconds : Number.MAX_SAFE_INTEGER;
            if (da !== dbb) return da - dbb;

            return safeCreatedAtMs(a) - safeCreatedAtMs(b);
        }).slice(0, 3);

        const medals = ['🥇', '🥈', '🥉'];
        top3List.innerHTML = topSorted.map((it, idx) => {
            const name = escapeHtml(String(it.name || '—'));
            const score = escapeHtml(formatScoreText(it));
            const percent = escapeHtml(String(normalizePercent(it)));
            const meta = escapeHtml(formatDateTimeAr(it.createdAtMs));
            return `<li>${medals[idx] || ''} ${name} — ${percent}% (${score})<small>${meta}</small></li>`;
        }).join('') || '<li>—</li>';

        // First people (first 5 attempts)
        const firstFew = items.slice(0, Math.min(5, items.length));
        firstPeopleList.innerHTML = firstFew.map((it, idx) => {
            const name = escapeHtml(String(it.name || '—'));
            const score = escapeHtml(formatScoreText(it));
            const meta = escapeHtml(formatDateTimeAr(it.createdAtMs));
            return `<li>#${idx + 1} ${name} — (${score})<small>${meta}</small></li>`;
        }).join('') || '<li>—</li>';

        // First attempt highlight
        const first = firstFew[0] || items[0];
        const fName = escapeHtml(String(first?.name || '—'));
        const fMode = escapeHtml(first?.examMode === 'challenge' ? 'تحدي' : 'اختبار');
        const fSubject = escapeHtml(String(first?.subject || '—'));
        const fScore = escapeHtml(formatScoreText(first || {}));
        const fPercent = escapeHtml(String(normalizePercent(first || {})));
        const fTime = escapeHtml(formatDateTimeAr(first?.createdAtMs));
        firstHighlight.innerHTML = `${fName}<br><small>${fMode} • ${fSubject} • ${fPercent}% (${fScore}) • ${fTime}</small>`;

        // Meta line
        if (insightsMeta) {
            const last = items[items.length - 1];
            const lastTxt = last ? `${escapeHtml(String(last.name || '—'))} • ${escapeHtml(formatDateTimeAr(last.createdAtMs))}` : '—';
            insightsMeta.innerHTML = `إجمالي المحاولات: <b>${items.length}</b> • آخر محاولة: <b>${lastTxt}</b>`;
        }

        insightsWrap.style.display = 'block';
    };

    const renderItems = (items) => {
        if (!Array.isArray(items) || items.length === 0) {
            tbody.innerHTML = '';
            status.textContent = 'مفيش بيانات لسه.';
            if (insightsWrap) insightsWrap.style.display = 'none';
            return;
        }

        // ترتيب حسب وقت الامتحان: الأقدم أولاً
        items.sort((a, b) => safeCreatedAtMs(a) - safeCreatedAtMs(b));

        updateInsights(items);

        const rows = items.map((it, idx) => {
            const name = escapeHtml(String(it.name || '—'));
            const mode = escapeHtml(it.examMode === 'challenge' ? 'تحدي' : 'اختبار');
            const subject = escapeHtml(String(it.subject || '—'));
            const score = escapeHtml(formatScoreText(it));
            const percent = (typeof it.percent === 'number') ? `${it.percent}%` : `${normalizePercent(it)}%`;
            const duration = (typeof it.durationText === 'string' && it.durationText.trim())
                ? escapeHtml(it.durationText)
                : (typeof it.durationSeconds === 'number' && typeof formatMMSS === 'function' ? formatMMSS(it.durationSeconds) : '—');
            const passed = !!it.passed;
            const badge = passed
                ? `<span class="status-badge status-pass">ناجح</span>`
                : `<span class="status-badge status-fail">راسب</span>`;
            const dateAr = escapeHtml(String(it.dateAr || '—'));
            const timeAr = it.createdAtMs ? `<br><small>${escapeHtml(new Date(it.createdAtMs).toLocaleTimeString('ar-EG'))}</small>` : '';

            return `<tr>
                <td>${idx + 1}</td>
                <td>${name}</td>
                <td>${mode}</td>
                <td>${subject}</td>
                <td>${score}</td>
                <td>${escapeHtml(percent)}</td>
                <td>${duration}</td>
                <td>${badge}</td>
                <td>${dateAr}${timeAr}</td>
            </tr>`;
        }).join('');

        tbody.innerHTML = rows;
        status.textContent = `تم التحميل: ${items.length} محاولة (مرتّبين حسب وقت الامتحان: الأقدم → الأحدث).`;
    };

    const renderFromDocs = (docs) => {
        const items = [];
        (docs || []).forEach((docSnap) => {
            const data = docSnap?.data ? docSnap.data() : (docSnap?.data || {});
            items.push({ id: docSnap?.id, ...data });
        });
        renderItems(items);
    };

    try {
        const attemptsCol = api.collection(db, FIRESTORE_ATTEMPTS_COLLECTION);
        const q = api.query(attemptsCol, api.orderBy('createdAtMs', 'asc'));

        // تحديث تلقائي بمجرد فتح القائمة
        if (api.onSnapshot) {
            __adminAttemptsUnsub = api.onSnapshot(q, (snap) => {
                renderFromDocs(snap.docs || []);
            }, (err) => {
                console.error(err);
                status.textContent = 'حصل خطأ أثناء التحديث المباشر.';
            });
        } else {
            const snap = await api.getDocs(q);
            renderFromDocs(snap.docs || []);
        }
    } catch (err) {
        console.error(err);
        status.textContent = 'حصل خطأ أثناء تحميل السجل. راجع Console.';
    }
}

function toggleAdminAttempts() {
    if (!isCurrentUserAdminRole()) {
        showAlert('للأدمن فقط.', 'error');
        return;
    }
    if (!isAdminUnlocked()) {
        showAlert('لازم تفتح الأدمن الأول.', 'error');
        openAdminAccessModal(true);
        return;
    }

    const container = document.getElementById('adminAttemptsContainer');
    const btn = document.getElementById('adminLoadAttemptsBtn');
    const refreshBtn = document.getElementById('adminRefreshAttemptsBtn');

    if (!container) return;

    const isHidden = container.style.display === 'none' || container.style.display === '';
    if (isHidden) {
        container.style.display = 'block';
        if (btn) btn.innerHTML = `<i class="fas fa-eye-slash"></i> إخفاء القائمة`;
        if (refreshBtn) refreshBtn.style.display = 'inline-flex';
        loadAdminAttempts(false);
    } else {
        container.style.display = 'none';
        if (btn) btn.innerHTML = `<i class="fas fa-eye"></i> عرض القائمة`;
        if (refreshBtn) refreshBtn.style.display = 'none';
        // stop live updates when hidden
        try {
            if (typeof __adminAttemptsUnsub === 'function') __adminAttemptsUnsub();
        } catch (e) {}
        __adminAttemptsUnsub = null;
    }
}


// ====== إدارة المستخدمين (للأدمن) ======
function toggleAdminUsers() {
    if (!isCurrentUserAdminRole()) {
        showAlert('للأدمن فقط.', 'error');
        return;
    }

    if (!isAdminUnlocked()) {
        showAlert('لازم تفتح الأدمن الأول.', 'error');
        openAdminAccessModal(true);
        return;
    }

    const container = document.getElementById('adminUsersContainer');
    const btn = document.getElementById('adminLoadUsersBtn');
    const refreshBtn = document.getElementById('adminRefreshUsersBtn');

    if (!container) return;

    const isHidden = container.style.display === 'none' || container.style.display === '';
    if (isHidden) {
        container.style.display = 'block';
        if (btn) btn.innerHTML = `<i class="fas fa-eye-slash"></i> إخفاء المستخدمين`;
        if (refreshBtn) refreshBtn.style.display = 'inline-flex';
        loadAdminUsers(false);
    } else {
        container.style.display = 'none';
        if (btn) btn.innerHTML = `<i class="fas fa-eye"></i> عرض المستخدمين`;
        if (refreshBtn) refreshBtn.style.display = 'none';
        try {
            if (typeof __adminUsersUnsub === 'function') __adminUsersUnsub();
        } catch (e) {}
        __adminUsersUnsub = null;
    }
}

function formatLastSeen(ms) {
    if (!ms) return '—';
    const d = new Date(ms);
    return d.toLocaleString('ar-EG');
}

function isOnlineFromLastSeen(ms) {
    if (!ms) return false;
    return (Date.now() - ms) <= 90 * 1000; // 90 ثانية
}

function buildExamStatusText(userData) {
    const currentExam = userData?.currentExam;
    const lastExam = userData?.lastExam;

    const online = isOnlineFromLastSeen(userData?.lastSeenMs);

    if (currentExam && currentExam.status === 'in_progress') {
        const started = currentExam.startedAtMs ? new Date(currentExam.startedAtMs).toLocaleTimeString('ar-EG') : '';
        const label = `بيمتحن الآن${online ? ' 🟢' : ' 🔴'} - ${escapeHtml(currentExam.mode || '')} - ${escapeHtml(currentExam.subject || '')}`;
        return started ? `${label}<br><small>بدأ: ${escapeHtml(started)}</small>` : label;
    }

    if (lastExam && lastExam.endedAtMs) {
        const ended = new Date(lastExam.endedAtMs).toLocaleString('ar-EG');
        const passTxt = lastExam.passed ? '✅ نجح' : '❌ لم ينجح';
        return `آخر امتحان: ${escapeHtml(lastExam.mode || '')} - ${escapeHtml(lastExam.subject || '')}<br><small>${passTxt} • ${escapeHtml(ended)}</small>`;
    }

    return 'لم يبدأ أي امتحان بعد';
}

async function loadAdminUsers(forceRefresh = false) {
    if (!isCurrentUserAdminRole()) return;
    if (!isAdminUnlocked()) return;

    const statusEl = document.getElementById('adminUsersStatus');
    const tbody = document.getElementById('adminUsersTableBody');

    if (!tbody || !statusEl) return;

    if (!isFirestoreReady()) {
        statusEl.textContent = 'Firebase غير جاهز.';
        return;
    }

    const api = window.firestoreApi;
    const db = window.firestoreDb;

    statusEl.textContent = 'جاري تحميل المستخدمين...';
    tbody.innerHTML = '';

    // Unsubscribe previous live listener
    try {
        if (typeof __adminUsersUnsub === 'function') __adminUsersUnsub();
    } catch (e) {}
    __adminUsersUnsub = null;

    const usersCol = api.collection(db, FIRESTORE_USERS_COLLECTION);
    const q = api.query(usersCol, api.orderBy('createdAtMs', 'desc'), api.limit(500));

    const render = (docs) => {
        const rows = [];
        let i = 0;

        docs.forEach((docSnap) => {
            const data = docSnap.data ? docSnap.data() : (docSnap.data || {});
            i++;

            const name = escapeHtml(data.displayName || '—');
            const email = escapeHtml(data.email || '—');
            const provider = escapeHtml(providerLabelFromId(data.providerId));
            const role = String(data.role || 'student').toLowerCase() === 'admin' ? 'admin' : 'student';
            const roleBadge = role === 'admin'
                ? '<span class="role-badge admin">ADMIN</span>'
                : '<span class="role-badge student">STUDENT</span>';

            const examStatus = buildExamStatusText(data);
            const lastSeen = formatLastSeen(data.lastSeenMs);
            const onlineDot = isOnlineFromLastSeen(data.lastSeenMs) ? '🟢' : '🔴';

            const uid = docSnap.id || data.uid || '';

            rows.push(`
                <tr>
                    <td>${i}</td>
                    <td>${name}</td>
                    <td dir="ltr">${email}</td>
                    <td>${provider}</td>
                    <td>غير متاح</td>
                    <td>${roleBadge}</td>
                    <td>${examStatus}</td>
                    <td>${onlineDot} ${escapeHtml(lastSeen)}</td>
                    <td>
                        <div class="role-actions">
                            <button class="role-btn make-admin" onclick="setUserRole('${escapeHtml(uid)}','admin')">
                                Admin
                            </button>
                            <button class="role-btn make-student" onclick="setUserRole('${escapeHtml(uid)}','student')">
                                Student
                            </button>
                        </div>
                    </td>
                </tr>
            `);
        });

        tbody.innerHTML = rows.join('') || '<tr><td colspan="9">لا يوجد مستخدمون</td></tr>';
        statusEl.textContent = `تم تحميل ${i} مستخدم.`;
    };

    try {
        if (api.onSnapshot && !forceRefresh) {
            __adminUsersUnsub = api.onSnapshot(q, (snap) => {
                render(snap.docs || []);
            }, (err) => {
                console.error(err);
                statusEl.textContent = 'حصل خطأ أثناء التحديث المباشر.';
            });
        } else {
            const snap = await api.getDocs(q);
            render(snap.docs || []);
        }
    } catch (e) {
        console.error(e);
        statusEl.textContent = 'حصل خطأ أثناء تحميل المستخدمين.';
    }
}

async function setUserRole(uid, role) {
    if (!isCurrentUserAdminRole()) {
        showAlert('للأدمن فقط.', 'error');
        return;
    }
    if (!isAdminUnlocked()) {
        showAlert('لازم تفتح الأدمن الأول.', 'error');
        openAdminAccessModal(true);
        return;
    }
    if (!uid) return;

    role = String(role || 'student').toLowerCase() === 'admin' ? 'admin' : 'student';

    try {
        const api = window.firestoreApi;
        const db = window.firestoreDb;
        const ref = api.doc(db, FIRESTORE_USERS_COLLECTION, uid);
        await api.updateDoc(ref, { role, roleUpdatedAtMs: Date.now() });
        showAlert(`تم تغيير الدور إلى ${role} ✅`, 'success');

        // refresh list
        loadAdminUsers(true);
    } catch (e) {
        console.error(e);
        showAlert('فشل تغيير الدور. راجع صلاحيات Firestore Rules.', 'error');
    }
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function lockAdminAccess() {
    setAdminUnlocked(false);
    updateAdminGateUI();

    // تنظيف أي محتوى قديم حتى لا يظهر بعد القفل
    const editor = document.getElementById('challengeQuestionsEditor');
    if (editor) editor.innerHTML = '';

    showAlert('تم قفل الإعدادات ✅', 'success');
}

function requireAdminForChallengeEdit() {
    if (isAdminUnlocked()) return true;
    openAdminAccessModal(true);
    return false;
}

function escapeHtml(str) {
    const s = String(str ?? '');
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
}

function getDraftQuestions() {
    if (!challengeQuestionsDraft) {
        challengeQuestionsDraft = deepClone(challengeQuestions);
    }
    return challengeQuestionsDraft;
}

function updateChallengeQuestionsCount() {
    const countEl = document.getElementById('challengeQuestionsCount');
    if (!countEl) return;
    const count = Array.isArray(getDraftQuestions()) ? getDraftQuestions().length : 0;
    countEl.textContent = `عدد الأسئلة: ${count}`;
    countEl.classList.toggle('warn', count < 15);
}

function renderChallengeQuestionsEditor() {
    const editor = document.getElementById('challengeQuestionsEditor');
    if (!editor) return;

    const questions = getDraftQuestions();
    const locked = !isAdminUnlocked();
    setChallengeEditingEnabled(!locked);
    editor.innerHTML = '';

    updateChallengeQuestionsCount();

    if (!Array.isArray(questions) || questions.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'no-results';
        empty.innerHTML = `
            <i class="fas fa-inbox"></i>
            <p>لا توجد أسئلة حالياً. اضغط "إضافة سؤال" للبدء.</p>
        `;
        editor.appendChild(empty);
        return;
    }

    questions.forEach((q, idx) => {
        const item = document.createElement('div');
        item.className = 'question-item';
        item.dataset.index = String(idx);

        const header = document.createElement('div');
        header.className = 'question-header';

        const number = document.createElement('div');
        number.className = 'question-number';
        number.textContent = `سؤال #${idx + 1}`;

        const removeBtn = document.createElement('button');
        removeBtn.className = 'question-remove';
        removeBtn.innerHTML = `<i class="fas fa-trash"></i> حذف`;
        removeBtn.onclick = () => deleteChallengeQuestionRow(idx);
        removeBtn.disabled = locked;

        header.appendChild(number);
        header.appendChild(removeBtn);

        const qText = document.createElement('textarea');
        qText.className = 'question-text';
        qText.placeholder = 'اكتب نص السؤال هنا...';
        qText.value = (q && typeof q.question === 'string') ? q.question : '';
        qText.disabled = locked;

        const optionsGrid = document.createElement('div');
        optionsGrid.className = 'options-grid';

        const options = Array.isArray(q?.options) ? q.options : [];
        const correctIndex = Number.isInteger(q?.correct) ? q.correct : 0;

        for (let i = 0; i < 4; i++) {
            const row = document.createElement('div');
            row.className = 'option-row';

            const radio = document.createElement('input');
            radio.type = 'radio';
            radio.name = `correct-${idx}`;
            radio.value = String(i);
            radio.checked = correctIndex === i;
            radio.disabled = locked;

            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'option-input';
            input.placeholder = `اختيار ${i + 1}`;
            input.value = typeof options[i] === 'string' ? options[i] : '';
            input.disabled = locked;

            row.appendChild(radio);
            row.appendChild(input);
            optionsGrid.appendChild(row);
        }

        item.appendChild(header);
        item.appendChild(qText);
        item.appendChild(optionsGrid);

        editor.appendChild(item);
    });
}

function addChallengeQuestionRow() {
    if (!requireAdminForChallengeEdit()) return;
    const questions = getDraftQuestions();
    questions.push({
        question: '',
        options: ['', '', '', ''],
        correct: 0
    });
    renderChallengeQuestionsEditor();
    // سكرول لآخر سؤال
    setTimeout(() => {
        const editor = document.getElementById('challengeQuestionsEditor');
        if (editor) editor.scrollTop = editor.scrollHeight;
    }, 50);
}

function deleteChallengeQuestionRow(index) {
    if (!requireAdminForChallengeEdit()) return;
    const questions = getDraftQuestions();
    if (!Array.isArray(questions) || index < 0 || index >= questions.length) return;

    const ok = confirm('هل أنت متأكد أنك تريد حذف هذا السؤال؟');
    if (!ok) return;

    questions.splice(index, 1);
    renderChallengeQuestionsEditor();
}

function readChallengeQuestionsFromEditor() {
    const editor = document.getElementById('challengeQuestionsEditor');
    if (!editor) return [];

    const items = Array.from(editor.querySelectorAll('.question-item'));
    return items.map((item) => {
        const question = String(item.querySelector('.question-text')?.value ?? '').trim();
        const optionInputs = Array.from(item.querySelectorAll('.option-row .option-input'));
        const options = optionInputs.slice(0, 4).map(inp => String(inp.value ?? '').trim());
        while (options.length < 4) options.push('');

        const checked = item.querySelector('input[type="radio"]:checked');
        let correct = checked ? parseInt(checked.value, 10) : 0;
        if (!Number.isInteger(correct) || correct < 0 || correct > 3) correct = 0;

        return { question, options, correct };
    });
}

function validateChallengeQuestions(questions) {
    if (!Array.isArray(questions) || questions.length === 0) {
        return { ok: false, message: 'لا توجد أسئلة لحفظها.' };
    }
    if (questions.length < 15) {
        return { ok: false, message: 'لازم يكون عندك 15 سؤال أو أكثر عشان وضع التحدي يشتغل.' };
    }

    for (let i = 0; i < questions.length; i++) {
        const q = questions[i];
        if (!q.question || q.question.trim().length === 0) {
            return { ok: false, message: `سؤال #${i + 1}: نص السؤال فاضي.` };
        }
        if (!Array.isArray(q.options) || q.options.length < 4) {
            return { ok: false, message: `سؤال #${i + 1}: لازم 4 اختيارات.` };
        }
        for (let j = 0; j < 4; j++) {
            if (!q.options[j] || String(q.options[j]).trim().length === 0) {
                return { ok: false, message: `سؤال #${i + 1}: اختيار ${j + 1} فاضي.` };
            }
        }
        if (!Number.isInteger(q.correct) || q.correct < 0 || q.correct > 3) {
            return { ok: false, message: `سؤال #${i + 1}: اختَر إجابة صحيحة.` };
        }
    }

    return { ok: true, message: 'OK' };
}

async function saveChallengeQuestionsFromEditor() {
    if (!requireAdminForChallengeEdit()) return;

    const editorQuestions = readChallengeQuestionsFromEditor();
    const validation = validateChallengeQuestions(editorQuestions);

    if (!validation.ok) {
        showAlert(validation.message || 'فيه خطأ في الأسئلة. راجعها وحاول تاني.', 'error');
        return;
    }

    // تخزينها كـ draft ثم حفظ
    challengeQuestionsDraft = editorQuestions;

    const ok = saveChallengeQuestions(editorQuestions);
    if (!ok) {
        showAlert('حصلت مشكلة أثناء حفظ الأسئلة. جرّب تاني.', 'error');
        return;
    }

    // حفظ على Firebase عشان يظهر عند كل المستخدمين
    const cloudOk = await saveChallengeQuestionsToFirestore(editorQuestions);

    if (cloudOk) {
        showAlert('تم حفظ أسئلة وضع التحدي بنجاح ✅', 'success');
    } else {
        showAlert('تم حفظ الأسئلة على جهازك فقط. فشل رفعها على Firebase (راجع الاتصال و Firestore Rules).', 'error');
    }

    renderChallengeQuestionsEditor();
}

async function resetChallengeQuestions() {
    if (!requireAdminForChallengeEdit()) return;
    const ok = confirm('هل تريد الرجوع للأسئلة الافتراضية؟ (سيتم استبدال الأسئلة الحالية)');
    if (!ok) return;

    localStorage.removeItem(CHALLENGE_QUESTIONS_KEY);
    challengeQuestions = deepClone(DEFAULT_CHALLENGE_QUESTIONS);
    challengeQuestionsDraft = deepClone(challengeQuestions);

    // ابعت الافتراضي لـ Firebase عشان الكل يرجع لنفس الأسئلة
    const cloudOk = await saveChallengeQuestionsToFirestore(challengeQuestions);

    if (cloudOk) {
        showAlert('تم الرجوع للأسئلة الافتراضية ✅', 'success');
    } else {
        showAlert('تم الرجوع للأسئلة الافتراضية على جهازك فقط. فشل رفعها على Firebase.', 'error');
    }

    renderChallengeQuestionsEditor();
}

function exportChallengeQuestions() {
    if (!requireAdminForChallengeEdit()) return;
    const toExport = Array.isArray(challengeQuestionsDraft) ? challengeQuestionsDraft : challengeQuestions;
    const blob = new Blob([JSON.stringify(toExport, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'challenge-questions.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showAlert('تم تصدير الملف ✅', 'success');
}

function importChallengeQuestionsFileClick() {
    if (!requireAdminForChallengeEdit()) return;
    const input = document.getElementById('importQuestionsFile');
    if (!input) return;
    input.value = '';
    input.click();
}

function handleImportQuestionsFile(event) {
    if (!requireAdminForChallengeEdit()) return;
    const file = event?.target?.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
        try {
            const text = String(reader.result ?? '');
            const parsed = JSON.parse(text);
            const normalized = normalizeChallengeQuestions(parsed);
            if (!normalized || normalized.length === 0) {
                showAlert('ملف JSON غير صالح أو فارغ.', 'error');
                return;
            }

            challengeQuestionsDraft = normalized;
            showAlert('تم استيراد الأسئلة ✅ (اضغط "حفظ الأسئلة" لتطبيقها)', 'success');
            renderChallengeQuestionsEditor();
        initDurationSettingsUI();
        } catch (e) {
            console.error(e);
            showAlert('تعذر قراءة ملف JSON. تأكد أن الملف صحيح.', 'error');
        }
    };
    reader.onerror = () => {
        showAlert('تعذر قراءة الملف.', 'error');
    };
    reader.readAsText(file);
}

// عرض نوع الامتحان المحدد
function showExamType(type) {
    // تحديث الأزرار النشطة
    document.querySelectorAll('.exam-type-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    
    // إضافة النشط للزر المختار
    event.target.classList.add('active');
    
    // إخفاء جميع واجهات الامتحان
    document.querySelectorAll('.exam-interface').forEach(interface => {
        interface.classList.remove('active');
    });
    
    // إظهار الواجهة المختارة
    document.getElementById(type + 'Exam').classList.add('active');
}

// ==========================================
// Challenge Mode Functions
// ==========================================

// فلترة الاسم من الشتائم
function filterName(name) {
    if (!name) return '';
    
    let filteredName = String(name).replace(/\s+/g, ' ').trim();
    const lowerName = filteredName.toLowerCase();
    
    // التحقق من الكلمات الممنوعة
    for (const word of bannedWords) {
        const regex = new RegExp(word, 'gi');
        if (regex.test(lowerName) || regex.test(filteredName)) {
            return null;
        }
    }
    
    // التحقق من الأسماء القصيرة جداً أو الطويلة جداً
    if (filteredName.length < 2 || filteredName.length > 60) {
        return null;
    }
    
    // رفض الأسماء التي كلها أرقام أو كلها رموز
    const onlyNumbers = /^[0-9]+$/;
    const onlySymbols = /^[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]+$/;
    if (onlyNumbers.test(filteredName) || onlySymbols.test(filteredName)) {
        return null;
    }

    // رفض الأسماء التي تحتوي على أرقام أو رموز
    const validName = /^[\u0600-\u06FFa-zA-Z ]+$/;
    if (!validName.test(filteredName)) {
        return null;
    }

    // رفض الأسماء التي فيها أكثر من 3 حروف متكررة متتالية
    if (/(.)\1{2,}/.test(filteredName)) {
        return null;
    }

    return filteredName;
}

// بدء وضع التحدي
function startChallenge() {
    ensureCurrentUserObject();

    // تحديث اسم المادة قبل بدء التحدي
    applyChallengeSubjectNameToUI();

    const effectiveName = getEffectiveUserName();
    if (!effectiveName) {
        openNameModal(() => startChallenge());
        return;
    }

    challengerName = effectiveName;

    // تحديث حالة الامتحان في Firestore (للأدمن)
    markExamStartedFirestore('challenge', getChallengeSubjectName(), 'challenge');

    // التأكد من توفر عدد كافٍ من الأسئلة
    if (!Array.isArray(challengeQuestions) || challengeQuestions.length < 15) {
        showAlert('أسئلة وضع التحدي غير كافية!\n\nادخل على الإعدادات وزوّد الأسئلة لحد ما تبقى 15 سؤال أو أكثر.', 'error');
        try {
            showSection('settings');
        } catch (e) {
            // تجاهل
        }
        return;
    }

    // خلط الأسئلة واختيار 15 سؤال عشوائي
    challengeQuestionsData = [...challengeQuestions];
    const shuffled = challengeQuestionsData.sort(() => Math.random() - 0.5);
    challengeQuestionsData = shuffled.slice(0, 15);

    currentChallengeIndex = 0;
    challengeAnswers = {};
    challengeTimeRemaining = getChallengeDurationSeconds();
    challengeStartTime = Date.now();

    // إخفاء المقدمة وإظهار التحدي
    const intro = document.getElementById('challengeIntro');
    const container = document.getElementById('challengeContainer');
    const result = document.getElementById('challengeResult');
    if (intro) intro.style.display = 'none';
    if (container) container.style.display = 'block';
    if (result) result.style.display = 'none';

    // بدء المؤقت
    startChallengeTimer();

    // عرض أول سؤال
    showChallengeQuestion();
    updateChallengeNav();
}


// بدء مؤقت التحدي
function startChallengeTimer() {
    const timerDisplay = document.getElementById('timerDisplay');
    const timerDiv = document.getElementById('challengeTimer');
    
    // إعادة تعيين الألوان
    timerDiv.classList.remove('warning', 'danger');
    timerDisplay.style.color = '';

    // تأكيد عرض الوقت الحالي
    timerDisplay.textContent = formatMMSS(challengeTimeRemaining);
    
    challengeTimerInterval = setInterval(() => {
        challengeTimeRemaining--;
        
        const minutes = Math.floor(challengeTimeRemaining / 60);
        const seconds = challengeTimeRemaining % 60;
        timerDisplay.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        
        // تحذير عند بقاء دقيقة واحدة
        if (challengeTimeRemaining <= 60) {
            timerDiv.classList.add('warning');
            timerDisplay.style.color = '#ffaa00';
        }
        
        // تحذير شديد عند 30 ثانية
        if (challengeTimeRemaining <= 30) {
            timerDiv.classList.add('danger');
            timerDisplay.style.color = '#ff4444';
        }
        
        // انتهاء الوقت
        if (challengeTimeRemaining <= 0) {
            clearInterval(challengeTimerInterval);
            submitChallenge();
        }
    }, 1000);
}

// عرض سؤال التحدي
function showChallengeQuestion() {
    const question = challengeQuestionsData[currentChallengeIndex];
    const questionDiv = document.getElementById('challengeQuestion');
    const optionsDiv = document.getElementById('challengeOptions');
    const progressSpan = document.getElementById('challengeProgress');
    
    // تحديث التقدم
    progressSpan.textContent = `${currentChallengeIndex + 1}/15`;
    
    // عرض السؤال
    questionDiv.innerHTML = `<span class="question-number">س${currentChallengeIndex + 1}:</span> ${question.question}`;
    
    // عرض الخيارات
    const letters = ['أ', 'ب', 'ج', 'د'];
    optionsDiv.innerHTML = question.options.map((option, i) => `
        <div class="challenge-option ${challengeAnswers[currentChallengeIndex] === i ? 'selected' : ''}" 
             onclick="selectChallengeOption(${i})">
            <span class="option-letter">${letters[i]}</span>
            <span class="option-text">${option}</span>
        </div>
    `).join('');
    
    updateChallengeNav();
}

// اختيار إجابة في التحدي
function selectChallengeOption(optionIndex) {
    challengeAnswers[currentChallengeIndex] = optionIndex;
    
    // تحديث النتيجة المباشرة
    updateChallengeScore();
    
    // إعادة عرض الخيارات
    showChallengeQuestion();
    
    // الانتقال التلقائي للسؤال التالي بعد 500ms
    if (currentChallengeIndex < challengeQuestionsData.length - 1) {
        setTimeout(() => {
            nextChallengeQuestion();
        }, 500);
    }
}

// تحديث النتيجة
function updateChallengeScore() {
    let score = 0;
    Object.keys(challengeAnswers).forEach(index => {
        if (challengeQuestionsData[index].correct === challengeAnswers[index]) {
            score++;
        }
    });
    document.getElementById('challengeScore').textContent = score;
}

// السؤال التالي في التحدي
function nextChallengeQuestion() {
    if (currentChallengeIndex < challengeQuestionsData.length - 1) {
        currentChallengeIndex++;
        showChallengeQuestion();
    }
}

// السؤال السابق في التحدي
function prevChallengeQuestion() {
    if (currentChallengeIndex > 0) {
        currentChallengeIndex--;
        showChallengeQuestion();
    }
}

// تحديث أزرار تنقل التحدي
function updateChallengeNav() {
    const prevBtn = document.getElementById('prevChallengeBtn');
    const nextBtn = document.getElementById('nextChallengeBtn');
    const submitBtn = document.getElementById('submitChallengeBtn');
    
    prevBtn.disabled = currentChallengeIndex === 0;
    
    if (currentChallengeIndex === challengeQuestionsData.length - 1) {
        nextBtn.style.display = 'none';
        submitBtn.style.display = 'inline-flex';
    } else {
        nextBtn.style.display = 'inline-flex';
        submitBtn.style.display = 'none';
    }
}

// إنهاء التحدي
function submitChallenge() {
    clearInterval(challengeTimerInterval);

    // حساب النتيجة
    let correctCount = 0;
    Object.keys(challengeAnswers).forEach(index => {
        if (challengeQuestionsData[index].correct === challengeAnswers[index]) {
            correctCount++;
        }
    });

    // حساب الوقت المستغرق
    const totalDuration = getChallengeDurationSeconds();
    const timeTaken = Math.max(0, totalDuration - challengeTimeRemaining);
    const minutes = Math.floor(timeTaken / 60);
    const seconds = timeTaken % 60;
    const timeString = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

    // حفظ النتيجة
    const effectiveName = getEffectiveUserName() || ANON_USER_NAME;
    const percent = Math.round((correctCount / 15) * 100);
    const passed = percent >= 50;

    const result = {
        name: effectiveName,
        score: correctCount,
        total: 15,
        percent: percent,
        passed: passed,
        time: timeString,
        timeSeconds: timeTaken,
        date: new Date().toLocaleDateString('ar-EG'),
        timestamp: Date.now(),
        isCurrentUser: true
    };

    saveChallengeResult(result);

    // عرض النتيجة
    showChallengeResult(correctCount, timeString);
}


// حفظ نتيجة التحدي
function saveChallengeResult(result) {
    // حفظ النتيجة محلياً
    let localResults = JSON.parse(localStorage.getItem('challengeResults')) || [];
    localResults.push(result);
    localStorage.setItem('challengeResults', JSON.stringify(localResults));

    // تحديث بيانات المستخدم (بدون اسم)
    ensureCurrentUserObject();
    appData.currentUser.challenges.push(result);
    appData.currentUser.points += (result.score || 0) * 10;
    updateUserLevel();
    saveCurrentUserData();

    // حفظ النتيجة في Firebase (Firestore)
    saveAttemptToFirestore({
        name: result.name || ANON_USER_NAME,
        examMode: 'challenge',
        subject: getChallengeSubjectName(),
        difficulty: 'challenge',
        correctAnswers: result.score,
        totalQuestions: result.total,
        percent: typeof result.percent === 'number' ? result.percent : Math.round(((result.score || 0) / (result.total || 1)) * 100),
        passed: typeof result.passed === 'boolean' ? result.passed : (((result.score || 0) / (result.total || 1)) * 100) >= 50,
        durationSeconds: result.timeSeconds,
        durationText: result.time,
        dateAr: result.date,
        source: 'web'
    }).then((ok) => {
        if (!ok) {
            showAlert('تعذر حفظ النتيجة على Firebase. تأكد من الإنترنت/الإعدادات.', 'error');
        }
    });

    // تحديث حالة الامتحان في Firestore (للأدمن)
    markExamFinishedFirestore('challenge', getChallengeSubjectName(), 'challenge', result.percent, result.passed);

    showAlert('تم حفظ نتيجتك ✅', 'success');
}

// حفظ في المتصدرين العالمي
function saveToGlobalLeaderboard(result) {
    let globalLeaderboard = JSON.parse(localStorage.getItem(GLOBAL_LEADERBOARD_KEY)) || [];

    // إضافة النتيجة الجديدة
    const entry = {
        id: Date.now() + '_' + Math.random().toString(36).substr(2, 9),
        name: result.name,
        score: result.score,
        total: result.total,
        time: result.time,
        timeSeconds: result.timeSeconds,
        date: result.date,
        timestamp: Date.now()
    };

    globalLeaderboard.push(entry);

    // ترتيب المتصدرين حسب النقاط (الأعلى أولاً) ثم الوقت (الأسرع أولاً)
    globalLeaderboard.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.timeSeconds - b.timeSeconds;
    });

    // الاحتفاظ بـ 100 نتيجة فقط
    if (globalLeaderboard.length > 100) {
        globalLeaderboard = globalLeaderboard.slice(0, 100);
    }

    localStorage.setItem(GLOBAL_LEADERBOARD_KEY, JSON.stringify(globalLeaderboard));
}

// عرض رسالة إنهاء التحدي
function showCompletionMessage() {
    // حفظ النتيجة في Firebase (Firestore)
    saveAttemptToFirestore({
        name: result.name || ANON_USER_NAME,
        examMode: 'challenge',
        subject: getChallengeSubjectName(),
        difficulty: 'challenge',
        correctAnswers: result.score,
        totalQuestions: result.total,
        percent: typeof result.percent === 'number' ? result.percent : Math.round(((result.score || 0) / (result.total || 1)) * 100),
        passed: typeof result.passed === 'boolean' ? result.passed : (((result.score || 0) / (result.total || 1)) * 100) >= 50,
        durationSeconds: result.timeSeconds,
        durationText: result.time,
        dateAr: result.date,
        source: 'web'
    });

    showAlert('تم حفظ نتيجتك ✅', 'success');
}

// تحديث عرض المتصدرين الثلاثة الأوائل
function updateTopThreeChampions() {
    const globalLeaderboard = loadGlobalLeaderboard();
    
    if (globalLeaderboard.length >= 1) {
        document.getElementById('firstPlaceName').textContent = globalLeaderboard[0].name;
        document.getElementById('firstPlaceScore').textContent = `${globalLeaderboard[0].score}/15`;
        document.getElementById('firstPlaceTime').textContent = globalLeaderboard[0].time;
    } else {
        document.getElementById('firstPlaceName').textContent = '--';
        document.getElementById('firstPlaceScore').textContent = '--/15';
        document.getElementById('firstPlaceTime').textContent = '--:--';
    }
    
    if (globalLeaderboard.length >= 2) {
        document.getElementById('secondPlaceName').textContent = globalLeaderboard[1].name;
        document.getElementById('secondPlaceScore').textContent = `${globalLeaderboard[1].score}/15`;
        document.getElementById('secondPlaceTime').textContent = globalLeaderboard[1].time;
    } else {
        document.getElementById('secondPlaceName').textContent = '--';
        document.getElementById('secondPlaceScore').textContent = '--/15';
        document.getElementById('secondPlaceTime').textContent = '--:--';
    }
    
    if (globalLeaderboard.length >= 3) {
        document.getElementById('thirdPlaceName').textContent = globalLeaderboard[2].name;
        document.getElementById('thirdPlaceScore').textContent = `${globalLeaderboard[2].score}/15`;
        document.getElementById('thirdPlaceTime').textContent = globalLeaderboard[2].time;
    } else {
        document.getElementById('thirdPlaceName').textContent = '--';
        document.getElementById('thirdPlaceScore').textContent = '--/15';
        document.getElementById('thirdPlaceTime').textContent = '--:--';
    }
}

// تحديث جدول المتصدرين العالمي
function updateChallengeLeaderboardTable() {
    const globalLeaderboard = loadGlobalLeaderboard();
    const tbody = document.getElementById('challengeLeaderboardBody');
    const currentUserName = appData.currentUser?.name || '';
    
    if (globalLeaderboard.length === 0) {
        document.getElementById('noChallengeRecords').style.display = 'block';
        tbody.innerHTML = '';
        return;
    }
    
    document.getElementById('noChallengeRecords').style.display = 'none';
    tbody.innerHTML = '';
    
    globalLeaderboard.forEach((entry, index) => {
        const isCurrentUser = entry.name === currentUserName;
        
        const row = document.createElement('tr');
        if (isCurrentUser) {
            row.classList.add('current-user');
        }
        
        if (index === 0) row.classList.add('gold-row');
        if (index === 1) row.classList.add('silver-row');
        if (index === 2) row.classList.add('bronze-row');
        
        row.innerHTML = `
            <td>${index + 1}</td>
            <td>
                ${getRankBadge(index + 1)}
                ${entry.name} 
                ${isCurrentUser ? '<span class="you-badge">(أنت)</span>' : ''}
            </td>
            <td>${entry.score}/${entry.total}</td>
            <td>${entry.time}</td>
            <td>${entry.date}</td>
        `;
        
        tbody.appendChild(row);
    });
}

// الحصول على رمز الرتبة
function getRankBadge(rank) {
    if (rank === 1) return '👑 ';
    if (rank === 2) return '🥈 ';
    if (rank === 3) return '🥉 ';
    return '';
}

// تحميل لوحة متصدرين التحدي
function loadChallengeLeaderboard() {
    const globalLeaderboard = loadGlobalLeaderboard();
    
    if (globalLeaderboard.length === 0) {
        document.getElementById('noChallengeRecords').style.display = 'block';
        document.getElementById('challengeLeaderboardBody').innerHTML = '';
        updateTopThreeChampions();
        updateChallengeUserStats();
        return;
    }
    
    document.getElementById('noChallengeRecords').style.display = 'none';
    
    // تحديث المتصدرين الثلاثة الأوائل
    updateTopThreeChampions();
    
    // تحديث إحصائيات المستخدم
    updateChallengeUserStats();
    
    // تحديث جدول المتصدرين
    updateChallengeLeaderboardTable();
}

// تحديث إحصائيات المستخدم في التحدي
function updateChallengeUserStats() {
    const globalLeaderboard = loadGlobalLeaderboard();
    const currentUserName = appData.currentUser?.name || '';
    
    if (globalLeaderboard.length === 0) {
        document.getElementById('userBestScore').textContent = '0';
        document.getElementById('userTotalChallenges').textContent = '0';
        document.getElementById('userAvgScore').textContent = '0%';
        document.getElementById('userChallengeRank').textContent = '--';
        return;
    }
    
    // تصفية نتائج المستخدم الحالي
    const userResults = globalLeaderboard.filter(r => r.name === currentUserName);
    const allLocalResults = JSON.parse(localStorage.getItem('challengeResults')) || [];
    const userLocalResults = allLocalResults.filter(r => r.name === currentUserName);
    
    if (userLocalResults.length === 0) {
        document.getElementById('userBestScore').textContent = '0';
        document.getElementById('userTotalChallenges').textContent = '0';
        document.getElementById('userAvgScore').textContent = '0%';
        document.getElementById('userChallengeRank').textContent = '--';
        return;
    }
    
    // أفضل نتيجة
    const bestScore = Math.max(...userLocalResults.map(r => r.score));
    document.getElementById('userBestScore').textContent = bestScore;
    
    // عدد المحاولات
    document.getElementById('userTotalChallenges').textContent = userLocalResults.length;
    
    // متوسط النتائج
    const avgScore = Math.round(userLocalResults.reduce((sum, r) => sum + r.score, 0) / userLocalResults.length);
    document.getElementById('userAvgScore').textContent = `${avgScore}/15`;
    
    // المركز في المتصدرين العالمي
    const userIndex = globalLeaderboard.findIndex(r => r.name === currentUserName);
    if (userIndex >= 0) {
        document.getElementById('userChallengeRank').textContent = `#${userIndex + 1}`;
    } else {
        document.getElementById('userChallengeRank').textContent = '--';
    }
}

// تصفية لوحة متصدرين التحدي
function filterChallengeLeaderboard(filter) {
    // تحديث الأزرار النشطة
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    
    event.target.classList.add('active');
    
    const globalLeaderboard = loadGlobalLeaderboard();
    
    let filteredResults = [...globalLeaderboard];
    
    if (filter === 'today') {
        const today = new Date().toLocaleDateString('ar-EG');
        filteredResults = globalLeaderboard.filter(r => r.date === today);
    } else if (filter === 'week') {
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        filteredResults = globalLeaderboard.filter(r => new Date(r.timestamp) >= weekAgo);
    }
    
    // ترتيب النتائج
    const sortedResults = filteredResults.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.timeSeconds - b.timeSeconds;
    });
    
    // تحديث العرض
    updateChallengeLeaderboardTable(sortedResults.slice(0, 50));
    updateTopThreeChampions(sortedResults);
}

// عرض نتيجة التحدي
function showChallengeResult(score, time) {
    document.getElementById('challengeContainer').style.display = 'none';
    document.getElementById('challengeResult').style.display = 'block';
    
    const resultIcon = document.getElementById('resultIcon');
    const resultTitle = document.getElementById('resultTitle');
    
    // تحديد الرمز والعنوان حسب النتيجة
    if (score >= 13) {
        resultIcon.textContent = '👑';
        resultTitle.textContent = 'ممتاز! أنت بطل الفضاء!';
        resultIcon.style.color = '#ffd700';
    } else if (score >= 10) {
        resultIcon.textContent = '🚀';
        resultTitle.textContent = 'أحسنت! نتيجة رائعة!';
        resultIcon.style.color = '#00ffff';
    } else if (score >= 7) {
        resultIcon.textContent = '🌟';
        resultTitle.textContent = 'جيد! استمر في التحسن!';
        resultIcon.style.color = '#ffaa00';
    } else {
        resultIcon.textContent = '💪';
        resultTitle.textContent = 'حاول مرة أخرى!';
        resultIcon.style.color = '#ff6666';
    }
    
    document.getElementById('finalScore').textContent = `${score}/15`;
    document.getElementById('finalTime').textContent = time;
    document.getElementById('correctAnswers').textContent = `${score}/15`;
}

// إعادة التحدي
function restartChallenge() {
    document.getElementById('challengeResult').style.display = 'none';
    document.getElementById('challengeIntro').style.display = 'block';
    
    // إعادة تعيين المؤقت
    document.getElementById('timerDisplay').textContent = formatMMSS(getChallengeDurationSeconds());
    document.getElementById('challengeTimer').classList.remove('warning', 'danger');
}

// ==========================================
// Quick Exam System
// ==========================================

// بدء اختبار سريع
function startQuickExam() {
    startQuickExamInternal();
}


function startQuickExamInternal() {
    ensureCurrentUserObject();
    const effectiveName = getEffectiveUserName();
    if (!effectiveName) {
        openNameModal(() => startQuickExamInternal());
        return;
    }
    const subject = document.getElementById('subjectSelect').value;
    const difficultyButtons = document.querySelectorAll('.difficulty-btn.active');
    const difficulty = difficultyButtons.length > 0 ? difficultyButtons[0].dataset.level : 'all';

    // تحديث حالة الامتحان في Firestore (للأدمن)
    markExamStartedFirestore('quick', subject, difficulty);
    
    // إعداد الامتحان
    appData.activeExam = {
        type: 'quick',
        subject: subject,
        difficulty: difficulty,
        questions: [],
        currentQuestion: 0,
        userAnswers: [],
        startTime: new Date(),
        score: 0,
        totalQuestions: 10
    };
    
    // تجميع الأسئلة المناسبة
    let allQuestions = [];
    
    if (subject === 'all') {
        // جميع المواد
        Object.values(appData.questionsBank).forEach(subjectQuestions => {
            allQuestions = allQuestions.concat(subjectQuestions);
        });
    } else {
        // مادة محددة
        allQuestions = appData.questionsBank[subject] || [];
    }
    
    // تصفية حسب الصعوبة إذا لم تكن "all"
    if (difficulty !== 'all') {
        allQuestions = allQuestions.filter(q => q.difficulty === difficulty);
    }
    
    // خلط الأسئلة واختيار 10
    allQuestions = shuffleArray(allQuestions).slice(0, 10);
    
    if (allQuestions.length === 0) {
        showAlert('لا توجد أسئلة متاحة للاختيارات المحددة', 'error');
        return;
    }
    
    appData.activeExam.questions = allQuestions;
    
    // إخفاء إعدادات الاختبار وإظهار واجهة الامتحان
    document.querySelector('.exam-setup').style.display = 'none';
    document.getElementById('activeExam').style.display = 'block';
    
    // تحديث معلومات الامتحان
    document.getElementById('examTitle').textContent = 
        `اختبار ${getSubjectName(subject)} ${difficulty === 'all' ? '' : difficulty === 'easy' ? 'سهل' : difficulty === 'medium' ? 'متوسط' : 'صعب'}`;
    
    document.getElementById('currentScore').textContent = '0 نقطة';
    
    // بدء المؤقت (حسب إعدادات الأدمن)
    startExamTimer(getQuickExamDurationSeconds());
    
    // عرض السؤال الأول
    displayQuestion(0);

}

// خلط مصفوفة
function shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

// بدء مؤقت الامتحان
function startExamTimer(seconds) {
    if (appData.examTimer) clearInterval(appData.examTimer);
    
    let timeLeft = seconds;
    
    appData.examTimer = setInterval(() => {
        timeLeft--;
        
        const minutes = Math.floor(timeLeft / 60);
        const secs = timeLeft % 60;
        
        document.getElementById('examTimer').textContent = 
            `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        
        // تحذير عند بقاء دقيقة واحدة
        if (timeLeft <= 60) {
            document.getElementById('examTimer').style.color = '#ff6666';
        }
        
        // انتهاء الوقت
        if (timeLeft <= 0) {
            clearInterval(appData.examTimer);
            finishExam();
        }
    }, 1000);
}

// عرض سؤال
function displayQuestion(questionIndex) {
    if (!appData.activeExam || questionIndex >= appData.activeExam.questions.length) {
        finishExam();
        return;
    }
    
    const question = appData.activeExam.questions[questionIndex];
    appData.activeExam.currentQuestion = questionIndex;
    
    // تحديث تقدم الامتحان
    document.getElementById('examProgress').textContent = `السؤال ${questionIndex + 1} من ${appData.activeExam.totalQuestions}`;
    
    // عرض نص السؤال
    document.getElementById('questionText').textContent = question.question;
    
    // عرض الخيارات
    const optionsContainer = document.getElementById('questionOptions');
    optionsContainer.innerHTML = '';
    
    const optionLetters = ['أ', 'ب', 'ج', 'د'];
    
    question.options.forEach((option, index) => {
        const optionDiv = document.createElement('div');
        optionDiv.className = 'question-option';
        
        // التحقق إذا كان المستخدم قد أجاب على هذا السؤال من قبل
        const userAnswer = appData.activeExam.userAnswers[questionIndex];
        if (userAnswer === index) {
            optionDiv.classList.add('selected');
        }
        
        optionDiv.innerHTML = `
            <span class="option-letter">${optionLetters[index]}</span>
            <span class="option-text">${option}</span>
        `;
        
        optionDiv.onclick = () => selectAnswer(index);
        optionsContainer.appendChild(optionDiv);
    });
    
    // تحديث أزرار التنقل
    updateExamNavigation();
}

// اختيار إجابة
function selectAnswer(optionIndex) {
    if (!appData.activeExam) return;
    
    const currentQuestion = appData.activeExam.currentQuestion;
    appData.activeExam.userAnswers[currentQuestion] = optionIndex;
    
    // إزالة التحديد من جميع الخيارات
    document.querySelectorAll('.question-option').forEach(option => {
        option.classList.remove('selected');
    });
    
    // إضافة التحديد للخيار المختار
    document.querySelectorAll('.question-option')[optionIndex].classList.add('selected');
}

// تحديث أزرار تنقل الامتحان
function updateExamNavigation() {
    if (!appData.activeExam) return;
    
    const currentQuestion = appData.activeExam.currentQuestion;
    const totalQuestions = appData.activeExam.totalQuestions;
    
    // زر السابق
    document.getElementById('prevQuestion').disabled = currentQuestion === 0;
    
    // زر التالي / إنهاء
    if (currentQuestion === totalQuestions - 1) {
        document.getElementById('nextQuestion').style.display = 'none';
        document.getElementById('finishExam').style.display = 'inline-flex';
    } else {
        document.getElementById('nextQuestion').style.display = 'inline-flex';
        document.getElementById('finishExam').style.display = 'none';
    }
}

// السؤال التالي
function nextQuestion() {
    if (!appData.activeExam) return;
    
    const nextIndex = appData.activeExam.currentQuestion + 1;
    
    if (nextIndex < appData.activeExam.totalQuestions) {
        displayQuestion(nextIndex);
    } else {
        finishExam();
    }
}

// السؤال السابق
function prevQuestion() {
    if (!appData.activeExam || appData.activeExam.currentQuestion === 0) return;
    
    displayQuestion(appData.activeExam.currentQuestion - 1);
}

// إنهاء الامتحان
function finishExam() {
    if (!appData.activeExam) return;
    
    // إيقاف المؤقت
    if (appData.examTimer) {
        clearInterval(appData.examTimer);
    }
    
    // حساب النتائج
    calculateExamResults();
    
    // إخفاء واجهة الامتحان
    document.getElementById('activeExam').style.display = 'none';
    
    // إظهار نافذة النتائج
    showExamResults();
    
    // إعادة عرض إعدادات الاختبار
    document.querySelector('.exam-setup').style.display = 'block';
    
    // إعادة تعيين الامتحان النشط
    appData.activeExam = null;
}

// حساب نتائج الامتحان
function calculateExamResults() {
    if (!appData.activeExam) return;
    
    let correctAnswers = 0;
    const totalQuestions = appData.activeExam.totalQuestions;
    
    for (let i = 0; i < totalQuestions; i++) {
        if (appData.activeExam.userAnswers[i] === appData.activeExam.questions[i].correct) {
            correctAnswers++;
        }
    }
    
    // كل إجابة صحيحة = 10 نقاط
    appData.activeExam.score = correctAnswers * 10;
    appData.activeExam.correctAnswers = correctAnswers;
    
    // حساب الوقت المستغرق
    const endTime = new Date();
    const timeTaken = Math.floor((endTime - appData.activeExam.startTime) / 1000); // بالثواني
    appData.activeExam.timeTaken = timeTaken;
    
    // حفظ النتائج
    saveExamResults(correctAnswers, totalQuestions);
}

// حفظ نتائج الامتحان
function saveExamResults(correctAnswers, totalQuestions) {
    if (!appData.currentUser) return;
    
    const effectiveName = getEffectiveUserName() || ANON_USER_NAME;
    const percent = Math.round((correctAnswers / Math.max(1, totalQuestions)) * 100);
    const passed = percent >= 50;

    const examResult = {
        name: effectiveName,
        type: appData.activeExam.type,
        subject: appData.activeExam.subject,
        difficulty: appData.activeExam.difficulty,
        score: appData.activeExam.score,
        correctAnswers: correctAnswers,
        totalQuestions: totalQuestions,
        percent: percent,
        passed: passed,
        timeTaken: appData.activeExam.timeTaken,
        timestamp: new Date().toISOString(),
        date: new Date().toLocaleDateString('ar-EG')
    };
    
    // إضافة إلى سجل الامتحانات
    appData.currentUser.exams.push(examResult);
    
    // تحديث النقاط الإجمالية
    appData.currentUser.points += appData.activeExam.score;
    
    // تحديث المستوى
    updateUserLevel();
    
    // حفظ بيانات المستخدم المحدثة
    saveCurrentUserData();

    // حفظ النتيجة في Firebase (Firestore)
    saveAttemptToFirestore({
        name: examResult.name,
        examMode: 'quick',
        subject: examResult.subject,
        difficulty: examResult.difficulty,
        correctAnswers: examResult.correctAnswers,
        totalQuestions: examResult.totalQuestions,
        scorePoints: examResult.score,
        percent: examResult.percent,
        passed: examResult.passed,
        durationSeconds: examResult.timeTaken,
        durationText: typeof formatMMSS === 'function' ? formatMMSS(examResult.timeTaken || 0) : String(examResult.timeTaken || 0),
        dateAr: examResult.date,
        source: 'web'
    }).then((ok) => {
        if (!ok) {
            // لا نزعج الطالب برسالة كل مرة إلا عند الفشل
            console.warn('Firebase save failed for exam result');
        }
    });

    // تحديث حالة الامتحان في Firestore (للأدمن)
    markExamFinishedFirestore('quick', examResult.subject, examResult.difficulty, examResult.percent, examResult.passed);

    // تحميل النتائج السابقة
    loadPreviousResults();
}

// تحديث مستوى المستخدم
function updateUserLevel() {
    if (!appData.currentUser) return;
    
    let level = 'مبتدئ';
    if (appData.currentUser.points >= 800) level = 'خبير';
    else if (appData.currentUser.points >= 500) level = 'متقدم';
    else if (appData.currentUser.points >= 200) level = 'متوسط';
    
    appData.currentUser.level = level;
}

// عرض نتائج الامتحان
function showExamResults() {
    if (!appData.activeExam) return;
    
    const accuracy = Math.round((appData.activeExam.correctAnswers / appData.activeExam.totalQuestions) * 100);
    
    // تحديث القيم في نافذة النتائج
    document.getElementById('finalScore').textContent = appData.activeExam.score;
    document.getElementById('correctAnswers').textContent = 
        `${appData.activeExam.correctAnswers}/${appData.activeExam.totalQuestions}`;
    
    // تنسيق الوقت المستغرق
    const minutes = Math.floor(appData.activeExam.timeTaken / 60);
    const seconds = appData.activeExam.timeTaken % 60;
    document.getElementById('examTime').textContent = 
        `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    
    document.getElementById('accuracyRate').textContent = accuracy + '%';
    
    // تحديد الرسالة والرمز المناسب
    let resultTitle = '';
    let resultMessage = '';
    let resultIcon = 'fas fa-trophy';
    let resultColor = '#00ff00';
    
    if (accuracy >= 90) {
        resultTitle = 'ممتاز! 👑';
        resultMessage = 'أداء رائع! أنت على مستوى عالٍ من المعرفة';
        resultIcon = 'fas fa-crown';
        resultColor = '#ffd700';
    } else if (accuracy >= 70) {
        resultTitle = 'جيد جداً! 👍';
        resultMessage = 'أداء قوي، استمر في التحسن';
        resultIcon = 'fas fa-star';
        resultColor = '#00ffff';
    } else if (accuracy >= 50) {
        resultTitle = 'جيد 💪';
        resultMessage = 'ليس سيئاً، ولكن يمكنك التحسن أكثر';
        resultIcon = 'fas fa-thumbs-up';
        resultColor = '#00aa00';
    } else {
        resultTitle = 'حاول مرة أخرى 📚';
        resultMessage = 'تحتاج للمزيد من المراجعة والتدريب';
        resultIcon = 'fas fa-book';
        resultColor = '#ff6666';
    }
    
    document.getElementById('resultTitle').textContent = resultTitle;
    document.getElementById('resultMessage').textContent = resultMessage;
    document.getElementById('resultTrophy').className = resultIcon;
    document.getElementById('resultTrophy').style.color = resultColor;
    
    // إظهار نافذة النتائج
    document.getElementById('examResultsModal').style.display = 'flex';
}

// مراجعة الإجابات
function reviewExam() {
    closeModal('examResultsModal');
    showAlert('ميزة مراجعة الإجابات قيد التطوير، ستتوفر قريباً!', 'info');
}

// مشاركة النتائج
function shareResults() {
    if (!appData.activeExam) return;
    
    const accuracy = Math.round((appData.activeExam.correctAnswers / appData.activeExam.totalQuestions) * 100);
    const shareText = `حصلت على ${appData.activeExam.score} نقطة في اختبار ${getSubjectName(appData.activeExam.subject)} على منصة بطوط التعليمية! 🚀\nالدقة: ${accuracy}%`;
    
    if (navigator.share) {
        navigator.share({
            title: 'نتيجة اختباري على منصة بطوط التعليمية',
            text: shareText,
            url: window.location.href
        });
    } else {
        // نسخ إلى الحافظة
        navigator.clipboard.writeText(shareText)
            .then(() => {
                showAlert('تم نسخ النتائج إلى الحافظة! يمكنك مشاركتها الآن.', 'success');
            })
            .catch(() => {
                showAlert('يمكنك نسخ النص يدوياً: ' + shareText, 'info');
            });
    }
}

// بدء اختبار مادة محددة
function startSubjectExam(subject) {
    // تعيين المادة المختارة
    document.getElementById('subjectSelect').value = subject;
    
    // تفعيل زر الاختبار السريع
    document.querySelectorAll('.exam-type-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelector('[onclick="showExamType(\'quick\')"]').classList.add('active');
    
    // إظهار قسم الامتحانات
    showSection('exams');
    
    // تفعيل مستوى متوسط افتراضياً
    document.querySelectorAll('.difficulty-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelector('[data-level="medium"]').classList.add('active');
    
    // إظهار قسم الاختبار السريع
    showExamType('quick');
    
    showAlert(`تم تحضير اختبار ${getSubjectName(subject)} لك. اضغط على "ابدأ الاختبار السريع" للبدء!`, 'info');
}

// فتح المحاضرات (بدون Firebase) — بيقرأ ملفات PDF من السيرفر داخل:
// lectures/<folderName>/*.pdf
// أسماء الفولدرات المطلوبة: math0 math1 physics elcronecs it computing history computer law en

const LECTURES_BASE_DIR = 'lectures';

// mapping بين كود المادة في الموقع واسم فولدر المحاضرات على السيرفر
const LECTURE_SUBJECT_FOLDER_MAP = {
    'math-zero': 'math0',
    'math': 'math1',
    'physics': 'physics',
    'electronics': 'elcronecs',
    'it': 'it',
    'computing-history': 'history',
    'computing-laws': 'law',
    'english': 'en',

    // اختياري (لو ضفت مواد بالكود ده في الـ HTML لاحقاً)
    'math0': 'math0',
    'math1': 'math1',
    'computing': 'computing',
    'history': 'history',
    'computer': 'computer',
    'law': 'law',
    'en': 'en'
};

const __lecturesState = {
    subject: '',
    folder: '',
    files: [],
    token: 0,
    // pdf viewer state
    pdfDoc: null,
    pageNum: 1,
    pageCount: 1,
    zoomFactor: 1.0
};

function mapSubjectToLecturesFolder(subject) {
    const s = String(subject || '').trim().toLowerCase();
    return LECTURE_SUBJECT_FOLDER_MAP[s] || s;
}

function openLectures(subject) {
    try {
        ensureLecturesModalExists();
        injectLecturesStylesOnce();

        __lecturesState.subject = String(subject || '');
        __lecturesState.folder = mapSubjectToLecturesFolder(subject);

        // reset viewer state
        __lecturesState.pdfDoc = null;
        __lecturesState.pageNum = 1;
        __lecturesState.pageCount = 1;
        __lecturesState.zoomFactor = 1.0;

        // UI
        const modal = document.getElementById('lecturesModal');
        const title = document.getElementById('lecturesSubjectTitle');
        const hint = document.getElementById('lecturesFolderHint');

        if (title) title.textContent = getSubjectName(subject);
        if (hint) hint.textContent = `المسار: ${LECTURES_BASE_DIR}/${__lecturesState.folder}/`;

        showLecturesListView();
        modal.style.display = 'flex';

        // تحميل القائمة
        loadLecturesList(__lecturesState.folder);
    } catch (e) {
        console.error(e);
        showAlert('حصل خطأ أثناء فتح المحاضرات.', 'error');
    }
}

function closeLecturesModal() {
    // اقفل المودال + نظّف الـ PDF
    try {
        if (__lecturesState.pdfDoc) {
            try { __lecturesState.pdfDoc.destroy?.(); } catch (e) {}
        }
        __lecturesState.pdfDoc = null;
        __lecturesState.files = [];
    } catch (e) {}
    try { closeModal('lecturesModal'); } catch (e) {
        const modal = document.getElementById('lecturesModal');
        if (modal) modal.style.display = 'none';
    }
}

function showLecturesListView() {
    const listView = document.getElementById('lecturesListView');
    const viewerView = document.getElementById('lecturesViewerView');
    if (listView) listView.style.display = 'block';
    if (viewerView) viewerView.style.display = 'none';
}

function showLecturesViewerView() {
    const listView = document.getElementById('lecturesListView');
    const viewerView = document.getElementById('lecturesViewerView');
    if (listView) listView.style.display = 'none';
    if (viewerView) viewerView.style.display = 'block';
}

function ensureLecturesModalExists() {
    if (document.getElementById('lecturesModal')) return;

    const modal = document.createElement('div');
    modal.id = 'lecturesModal';
    modal.className = 'modal lectures-modal';
    modal.style.display = 'none';

    modal.innerHTML = `
      <div class="modal-content lectures-modal-content" role="dialog" aria-modal="true">
        <div class="modal-header lectures-header">
          <h2 class="lectures-title">
            <i class="fas fa-book"></i>
            محاضرات <span id="lecturesSubjectTitle"></span>
          </h2>
          <button class="close-modal" type="button" aria-label="إغلاق" id="lecturesCloseBtn">
            <i class="fas fa-times"></i>
          </button>
        </div>

        <div class="modal-body lectures-body">

          <!-- List View -->
          <div id="lecturesListView">
            <div class="lectures-toolbar">
              <div class="lectures-path" id="lecturesFolderHint"></div>
              <button class="control-btn" type="button" id="lecturesRefreshBtn">
                <i class="fas fa-rotate"></i> تحديث
              </button>
            </div>

            <div class="lectures-status" id="lecturesStatus"></div>
            <div class="lectures-files" id="lecturesFiles"></div>
          </div>

          <!-- Viewer View -->
          <div id="lecturesViewerView" style="display:none;">
            <div class="viewer-topbar">
              <button class="control-btn" type="button" id="viewerBackBtn">
                <i class="fas fa-arrow-right"></i> رجوع
              </button>

              <div class="viewer-file-name" id="viewerFileName"></div>

              <a class="control-btn" id="viewerDownloadBtn" href="#" download>
                <i class="fas fa-download"></i> تحميل
              </a>
            </div>

            <div class="viewer-controls">
              <button class="control-btn" type="button" id="prevPdfPageBtn">
                <i class="fas fa-chevron-right"></i> السابق
              </button>

              <span class="viewer-page-indicator">
                <span id="pdfPageNum">1</span> / <span id="pdfPageCount">1</span>
              </span>

              <button class="control-btn" type="button" id="nextPdfPageBtn">
                <i class="fas fa-chevron-left"></i> التالي
              </button>

              <button class="control-btn" type="button" id="zoomOutBtn" title="تصغير">
                <i class="fas fa-search-minus"></i>
              </button>
              <button class="control-btn" type="button" id="zoomInBtn" title="تكبير">
                <i class="fas fa-search-plus"></i>
              </button>
            </div>

            <div class="viewer-canvas-wrap" id="pdfCanvasWrap">
              <div class="viewer-loading" id="pdfLoading" style="display:none;">
                <span class="loading"></span> جاري تحميل الـ PDF...
              </div>
              <canvas id="pdfCanvas"></canvas>
            </div>
          </div>

        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // close button
    document.getElementById('lecturesCloseBtn')?.addEventListener('click', closeLecturesModal);

    // click outside content closes
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeLecturesModal();
    });

    // refresh
    document.getElementById('lecturesRefreshBtn')?.addEventListener('click', () => {
        loadLecturesList(__lecturesState.folder, true);
    });

    // back from viewer
    document.getElementById('viewerBackBtn')?.addEventListener('click', () => {
        try {
            if (__lecturesState.pdfDoc) {
                try { __lecturesState.pdfDoc.destroy?.(); } catch (e) {}
            }
        } catch (e) {}
        __lecturesState.pdfDoc = null;
        showLecturesListView();
    });

    // paging
    document.getElementById('prevPdfPageBtn')?.addEventListener('click', () => {
        if (!__lecturesState.pdfDoc) return;
        if (__lecturesState.pageNum <= 1) return;
        __lecturesState.pageNum -= 1;
        renderPdfPage(__lecturesState.pageNum);
    });

    document.getElementById('nextPdfPageBtn')?.addEventListener('click', () => {
        if (!__lecturesState.pdfDoc) return;
        if (__lecturesState.pageNum >= __lecturesState.pageCount) return;
        __lecturesState.pageNum += 1;
        renderPdfPage(__lecturesState.pageNum);
    });

    // zoom
    document.getElementById('zoomInBtn')?.addEventListener('click', () => {
        if (!__lecturesState.pdfDoc) return;
        __lecturesState.zoomFactor = Math.min(3, __lecturesState.zoomFactor * 1.12);
        renderPdfPage(__lecturesState.pageNum);
    });

    document.getElementById('zoomOutBtn')?.addEventListener('click', () => {
        if (!__lecturesState.pdfDoc) return;
        __lecturesState.zoomFactor = Math.max(0.5, __lecturesState.zoomFactor / 1.12);
        renderPdfPage(__lecturesState.pageNum);
    });

    // keyboard (Esc / arrows)
    document.addEventListener('keydown', (e) => {
        const modalEl = document.getElementById('lecturesModal');
        if (!modalEl || modalEl.style.display !== 'flex') return;

        if (e.key === 'Escape') {
            closeLecturesModal();
            return;
        }

        if (!__lecturesState.pdfDoc) return;

        if (e.key === 'ArrowLeft') {
            document.getElementById('nextPdfPageBtn')?.click();
        } else if (e.key === 'ArrowRight') {
            document.getElementById('prevPdfPageBtn')?.click();
        }
    });
}

function injectLecturesStylesOnce() {
    if (document.getElementById('lecturesStyles')) return;

    const st = document.createElement('style');
    st.id = 'lecturesStyles';
    st.textContent = `
      .lectures-modal .lectures-modal-content { max-width: 980px; width: 95%; }
      .lectures-header { display:flex; align-items:center; justify-content:space-between; gap:12px; }
      .lectures-title { margin:0; font-size: 1.2rem; }
      .lectures-body { padding: 14px; }

      .lectures-toolbar { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom: 10px; }
      .lectures-path { opacity: .85; font-size: .9rem; word-break: break-all; }

      .lectures-status { margin: 8px 0 12px; opacity: .9; }
      .lectures-files { display:flex; flex-direction:column; gap: 10px; }

      .lecture-file-item { display:flex; align-items:center; justify-content:space-between; gap: 10px; padding: 10px 12px; border: 1px solid rgba(255,255,255,.12); border-radius: 12px; background: rgba(0,0,0,.18); }
      .lecture-file-name { font-weight: 700; overflow:hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 60%; }
      .lecture-file-actions { display:flex; gap: 8px; flex-wrap:wrap; justify-content:flex-end; }
      .lecture-file-actions .control-btn { padding: 8px 10px; font-size: .9rem; }

      .viewer-topbar { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom: 10px; }
      .viewer-file-name { flex:1; text-align:center; font-weight:800; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }

      .viewer-controls { display:flex; align-items:center; justify-content:center; gap: 10px; margin-bottom: 10px; flex-wrap: wrap; }
      .viewer-page-indicator { font-weight: 800; opacity:.95; }

      .viewer-canvas-wrap { position: relative; border-radius: 12px; border: 1px solid rgba(255,255,255,.12); background: rgba(0,0,0,.18); padding: 10px; max-height: 70vh; overflow: auto; }
      #pdfCanvas { display:block; margin: 0 auto; border-radius: 8px; }

      .viewer-loading { position: absolute; inset: 0; display:flex; align-items:center; justify-content:center; gap: 10px; backdrop-filter: blur(2px); }
      .viewer-loading .loading { width: 18px; height: 18px; border-radius: 50%; border: 3px solid rgba(255,255,255,.2); border-top-color: rgba(255,255,255,.9); animation: spin 1s linear infinite; }
      @keyframes spin { to { transform: rotate(360deg); } }

      @media (max-width: 640px) {
        .lecture-file-item { flex-direction: column; align-items: flex-start; }
        .lecture-file-name { max-width: 100%; }
        .lecture-file-actions { width:100%; justify-content:flex-start; }
        .viewer-file-name { text-align:right; }
      }
    `;
    document.head.appendChild(st);
}

async function loadLecturesList(folder, force = false) {
    const token = ++__lecturesState.token;

    const statusEl = document.getElementById('lecturesStatus');
    const filesEl = document.getElementById('lecturesFiles');
    if (!filesEl) return;

    filesEl.innerHTML = '';
    if (statusEl) statusEl.innerHTML = `<span class="loading"></span> جاري تحميل ملفات المحاضرات...`;

    try {
        const list = await listPdfFilesFromFolder(folder, force);

        // لو فتح مادة تانية بسرعة
        if (token !== __lecturesState.token) return;

        __lecturesState.files = list;

        if (!Array.isArray(list) || list.length === 0) {
            if (statusEl) statusEl.textContent = 'مفيش ملفات PDF في الفولدر ده.';
            return;
        }

        if (statusEl) statusEl.textContent = `تم العثور على ${list.length} ملف PDF.`;

        for (const fileUrl of list) {
            const item = document.createElement('div');
            item.className = 'lecture-file-item';

            const nameDiv = document.createElement('div');
            nameDiv.className = 'lecture-file-name';
            nameDiv.title = fileUrl;
            nameDiv.textContent = decodeURIComponent(String(fileUrl).split('/').pop() || 'file.pdf');

            const actions = document.createElement('div');
            actions.className = 'lecture-file-actions';

            const dl = document.createElement('a');
            dl.className = 'control-btn';
            dl.href = fileUrl;
            dl.setAttribute('download', '');
            dl.innerHTML = `<i class="fas fa-download"></i> تحميل`;

            const openBtn = document.createElement('button');
            openBtn.className = 'control-btn';
            openBtn.type = 'button';
            openBtn.innerHTML = `<i class="fas fa-eye"></i> فتح`;
            openBtn.addEventListener('click', () => openLecturePdf(fileUrl));

            actions.appendChild(dl);
            actions.appendChild(openBtn);

            item.appendChild(nameDiv);
            item.appendChild(actions);

            filesEl.appendChild(item);
        }
    } catch (err) {
        console.error(err);
        if (token !== __lecturesState.token) return;

        if (statusEl) {
            statusEl.innerHTML =
              `مش قادر أجيب قائمة الملفات من <b>${LECTURES_BASE_DIR}/${escapeHtml(folder)}/</b>.<br>
               <small>لازم السيرفر يسمح بعرض محتوى الفولدر (Directory Listing/AutoIndex) أو توفّر ملف <b>manifest.json</b> داخل الفولدر يحتوي أسماء ملفات الـ PDF.</small>`;
        }
    }
}

async function listPdfFilesFromFolder(folder, force = false) {
    const safeFolder = String(folder || '').replace(/^\/*/, '').replace(/\/*$/, '');
    const basePath = `${LECTURES_BASE_DIR}/${safeFolder}/`;
    const baseUrl = new URL(basePath, window.location.href).toString();

    // 1) حاول manifest.json (اختياري)
    try {
        const manifestUrl = new URL('manifest.json', baseUrl).toString();
        const r = await fetch(manifestUrl, { cache: force ? 'no-store' : 'default' });
        if (r.ok) {
            const data = await r.json();
            // يقبل: ["a.pdf","b.pdf"] أو {files:[...]}
            const arr = Array.isArray(data) ? data : (Array.isArray(data?.files) ? data.files : []);
            const out = arr
                .map(x => String(x || '').trim())
                .filter(x => x && x.toLowerCase().endsWith('.pdf'))
                .map(x => new URL(x, baseUrl).toString());
            return Array.from(new Set(out));
        }
    } catch (e) {
        // تجاهل
    }

    // 2) حاول تقرأ directory listing HTML
    const res = await fetch(baseUrl, { cache: force ? 'no-store' : 'default' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();

    const out = parseDirectoryListingForPdfs(html, baseUrl);
    return Array.from(new Set(out));
}

function parseDirectoryListingForPdfs(html, baseUrl) {
    // يدعم Apache/Nginx autoindex ومعظم listings
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    const anchors = Array.from(doc.querySelectorAll('a[href]'));
    const pdfs = [];

    for (const a of anchors) {
        const raw = a.getAttribute('href');
        if (!raw) continue;

        // تجاهل parent link / sort links
        if (raw === '../' || raw.startsWith('?')) continue;

        const clean = raw.split('?')[0].split('#')[0];
        if (!clean.toLowerCase().endsWith('.pdf')) continue;

        // resolve to absolute URL
        try {
            const u = new URL(clean, baseUrl).toString();
            pdfs.push(u);
        } catch (e) {}
    }

    // ترتيب لطيف (A-Z)
    pdfs.sort((a, b) => a.localeCompare(b, 'en'));
    return pdfs;
}

async function ensurePdfJsLoaded() {
    // لو موجودة بالفعل
    if (window.pdfjsLib && window.pdfjsLib.getDocument) return;

    // ملاحظة: في إصدارات PDF.js الحديثة، ملف build/ ممكن يكون ESM ومايطلعش pdfjsLib كـ global.
    // لذلك بنجرب legacy/build أولاً (مناسب للـ CDN) ثم fallback.
    const ver = '5.4.530'; // stable (late 2025)

    const candidates = [
        {
            lib: `https://cdn.jsdelivr.net/npm/pdfjs-dist@${ver}/legacy/build/pdf.min.js`,
            worker: `https://cdn.jsdelivr.net/npm/pdfjs-dist@${ver}/legacy/build/pdf.worker.min.js`,
        },
        // fallback قديم جاهز كـ UMD globals
        {
            lib: `https://cdn.jsdelivr.net/npm/pdfjs-dist-legacy/pdf.min.js`,
            worker: `https://cdn.jsdelivr.net/npm/pdfjs-dist-legacy/pdf.worker.min.js`,
        },
    ];

    let lastErr = null;

    // نظّف أي بقايا سابقة
    try {
        const old = document.getElementById('pdfjsLibScript');
        if (old && !old.__keep) old.remove();
    } catch (e) {}

    for (const c of candidates) {
        try {
            // حمّل المكتبة
            await loadScriptOnce(c.lib, 'pdfjsLibScript');

            // بعض الـ builds بتطلعها في أماكن مختلفة
            window.pdfjsLib =
                window.pdfjsLib ||
                window['pdfjs-dist/build/pdf'] ||
                (window.exports && window.exports['pdfjs-dist/build/pdf']) ||
                (window.exports && window.exports.pdfjsLib);

            if (window.pdfjsLib && window.pdfjsLib.getDocument) {
                // worker
                try {
                    window.pdfjsLib.GlobalWorkerOptions.workerSrc = c.worker;
                } catch (e) {}
                // علِّم السكربت إنه ناجح
                const s = document.getElementById('pdfjsLibScript');
                if (s) s.__keep = true;
                return;
            }

            // لو اتحمل لكن مافيش global، جرّب اللي بعده
            lastErr = new Error('PDF.js loaded but pdfjsLib global not found');
            const s = document.getElementById('pdfjsLibScript');
            if (s && !s.__keep) s.remove();
            // امسح أي references
            try { delete window.pdfjsLib; } catch (e) {}
        } catch (e) {
            lastErr = e;
            try {
                const s = document.getElementById('pdfjsLibScript');
                if (s && !s.__keep) s.remove();
            } catch (ee) {}
            try { delete window.pdfjsLib; } catch (ee) {}
        }
    }

    throw lastErr || new Error('Unable to load PDF.js');
}

function loadScriptOnce(src, id) {
    return new Promise((resolve, reject) => {
        if (id && document.getElementById(id)) return resolve();
        const s = document.createElement('script');
        if (id) s.id = id;
        s.src = src;
        s.async = true;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error('Failed to load script: ' + src));
        document.head.appendChild(s);
    });
}


function setPdfControlsEnabled(enabled) {
    const ids = ['prevPdfPageBtn', 'nextPdfPageBtn', 'zoomInBtn', 'zoomOutBtn'];
    for (const id of ids) {
        const el = document.getElementById(id);
        if (!el) continue;
        el.disabled = !enabled;
        el.classList.toggle('disabled', !enabled);
    }
    const indicator = document.querySelector('.viewer-page-indicator');
    if (indicator) indicator.style.opacity = enabled ? '1' : '0.6';
}

function ensurePdfIframe() {
    const wrap = document.getElementById('pdfCanvasWrap');
    if (!wrap) return null;
    let iframe = document.getElementById('pdfIframe');
    if (!iframe) {
        iframe = document.createElement('iframe');
        iframe.id = 'pdfIframe';
        iframe.title = 'PDF Viewer';
        iframe.loading = 'lazy';
        iframe.style.width = '100%';
        iframe.style.height = '100%';
        iframe.style.border = '0';
        iframe.style.display = 'none';
        wrap.appendChild(iframe);
    }
    return iframe;
}

function fallbackOpenPdfInIframe(fileUrl, err) {
    try {
        const iframe = ensurePdfIframe();
        if (!iframe) return false;

        // تعطيل وضع PDF.js
        __lecturesState.pdfDoc = null;

        // تحديث واجهة الصفحات (مش هتشتغل مع iframe)
        const pn = document.getElementById('pdfPageNum');
        const pc = document.getElementById('pdfPageCount');
        if (pn) pn.textContent = '-';
        if (pc) pc.textContent = '-';
        setPdfControlsEnabled(false);

        const canvas = document.getElementById('pdfCanvas');
        if (canvas) canvas.style.display = 'none';

        iframe.style.display = 'block';
        iframe.src = fileUrl;

        // رسالة مفيدة بدل "مش هقدر" بدون تفاصيل
        showAlert('تعذّر تشغيل عارض PDF داخل الموقع، فتم فتح الملف داخل عارض المتصفح.', 'info');
        return true;
    } catch (e) {
        console.error(e);
        return false;
    }
}


async function openLecturePdf(fileUrl) {
    try {
        showLecturesViewerView();

        // تأكد إننا في وضع PDF.js (مش iframe)
        const __iframe = ensurePdfIframe();
        if (__iframe) {
            __iframe.style.display = 'none';
            try { __iframe.src = 'about:blank'; } catch (e) {}
        }
        const __canvas = document.getElementById('pdfCanvas');
        if (__canvas) __canvas.style.display = 'block';
        setPdfControlsEnabled(true);


        const fileName = decodeURIComponent(String(fileUrl).split('/').pop() || 'file.pdf');
        const nameEl = document.getElementById('viewerFileName');
        const dl = document.getElementById('viewerDownloadBtn');
        const loading = document.getElementById('pdfLoading');

        if (nameEl) nameEl.textContent = fileName;
        if (dl) {
            dl.href = fileUrl;
            dl.setAttribute('download', '');
        }

        if (loading) loading.style.display = 'flex';

        await ensurePdfJsLoaded();
        if (!window.pdfjsLib) throw new Error('pdfjsLib not available');

        // destroy previous
        try {
            if (__lecturesState.pdfDoc) {
                try { __lecturesState.pdfDoc.destroy?.(); } catch (e) {}
            }
        } catch (e) {}

        let pdf = null;

// جرّب عادي (Worker)
try {
    const loadingTask = window.pdfjsLib.getDocument({ url: fileUrl });
    pdf = await loadingTask.promise;
} catch (e) {
    // fallback: بدون Worker (بيحل مشاكل CORS/Worker/file:// في بعض البيئات)
    try {
        const loadingTask2 = window.pdfjsLib.getDocument({ url: fileUrl, disableWorker: true });
        pdf = await loadingTask2.promise;
    } catch (e2) {
        throw e2;
    }
}

        __lecturesState.pdfDoc = pdf;
        __lecturesState.pageCount = pdf.numPages || 1;
        __lecturesState.pageNum = 1;
        __lecturesState.zoomFactor = 1.0;

        // update counters
        const pn = document.getElementById('pdfPageNum');
        const pc = document.getElementById('pdfPageCount');
        if (pn) pn.textContent = '1';
        if (pc) pc.textContent = String(__lecturesState.pageCount);

        await renderPdfPage(1);
    } catch (err) {
        console.error(err);
        const usedFallback = fallbackOpenPdfInIframe(fileUrl, err);
        if (!usedFallback) {
            const extra = (err && err.message) ? ` (${err.message})` : '';
            showAlert('مش قادر أفتح ملف الـ PDF ده.' + extra, 'error');
            showLecturesListView();
        }
    } finally {
        const loading = document.getElementById('pdfLoading');
        if (loading) loading.style.display = 'none';
    }
}

async function renderPdfPage(pageNum) {
    const pdf = __lecturesState.pdfDoc;
    if (!pdf) return;

    const canvas = document.getElementById('pdfCanvas');
    const wrap = document.getElementById('pdfCanvasWrap');
    if (!canvas || !wrap) return;

    const page = await pdf.getPage(pageNum);

    // fit-to-width * zoomFactor
    const baseViewport = page.getViewport({ scale: 1 });
    const availableWidth = Math.max(280, (wrap.clientWidth || 800) - 24); // padding
    const fitScale = availableWidth / baseViewport.width;
    const scale = fitScale * __lecturesState.zoomFactor;

    const viewport = page.getViewport({ scale });

    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);

    const ctx = canvas.getContext('2d', { alpha: false });
    await page.render({ canvasContext: ctx, viewport }).promise;

    __lecturesState.pageNum = pageNum;

    const pn = document.getElementById('pdfPageNum');
    const pc = document.getElementById('pdfPageCount');
    if (pn) pn.textContent = String(pageNum);
    if (pc) pc.textContent = String(__lecturesState.pageCount);

    // enable/disable buttons
    const prevBtn = document.getElementById('prevPdfPageBtn');
    const nextBtn = document.getElementById('nextPdfPageBtn');
    if (prevBtn) prevBtn.disabled = pageNum <= 1;
    if (nextBtn) nextBtn.disabled = pageNum >= __lecturesState.pageCount;
}


// ==========================================
// AI Assistant System
// ==========================================

// إرسال سؤال للمساعد الذكي
function sendAIQuestion() {
    const questionInput = document.getElementById('aiQuestionInput');
    const question = questionInput.value.trim();
    
    if (!question) {
        showAlert('من فضلك اكتب سؤالك أولاً!', 'error');
        questionInput.focus();
        return;
    }
    
    // إضافة سؤال المستخدم إلى المحادثة
    addUserMessage(question);
    
    // مسح حقل الإدخال
    questionInput.value = '';
    
    // إظهار مؤشر التفكير
    showThinkingIndicator();
    
    // محاكاة رد المساعد الذكي
    setTimeout(() => {
        // إزالة مؤشر التفكير
        removeThinkingIndicator();
        
        // إجابة ذكية بناءً على السؤال
        const aiResponse = generateAIResponse(question);
        
        // إضافة رد المساعد
        addAIMessage(aiResponse);
        
        // حفظ في سجل المحادثة
        appData.aiChatHistory.push({
            question: question,
            answer: aiResponse,
            timestamp: new Date()
        });
    }, 1500);
}

// إضافة رسالة المستخدم
function addUserMessage(message) {
    const chatMessages = document.getElementById('chatMessages');
    
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message user-message';
    messageDiv.innerHTML = `
        <div class="message-avatar">
            <i class="fas fa-user"></i>
        </div>
        <div class="message-content">
            <div class="message-sender">أنت</div>
            <div class="message-text">${message}</div>
            <div class="message-time">${new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}</div>
        </div>
    `;
    
    chatMessages.appendChild(messageDiv);
    scrollToBottom();
}

// إضافة رسالة المساعد الذكي
function addAIMessage(message) {
    const chatMessages = document.getElementById('chatMessages');
    
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message ai-message';
    messageDiv.innerHTML = `
        <div class="message-avatar">
            <i class="fas fa-robot"></i>
        </div>
        <div class="message-content">
            <div class="message-sender">المساعد الذكي</div>
            <div class="message-text">${message}</div>
            <div class="message-time">${new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}</div>
        </div>
    `;
    
    chatMessages.appendChild(messageDiv);
    scrollToBottom();
}

// إظهار مؤشر التفكير
function showThinkingIndicator() {
    const chatMessages = document.getElementById('chatMessages');
    
    const thinkingDiv = document.createElement('div');
    thinkingDiv.className = 'message ai-message';
    thinkingDiv.id = 'thinkingIndicator';
    thinkingDiv.innerHTML = `
        <div class="message-avatar">
            <i class="fas fa-robot"></i>
        </div>
        <div class="message-content">
            <div class="message-sender">المساعد الذكي</div>
            <div class="message-text">
                <div class="thinking-dots">
                    <span>.</span><span>.</span><span>.</span>
                </div>
            </div>
        </div>
    `;
    
    chatMessages.appendChild(thinkingDiv);
    scrollToBottom();
}

// إزالة مؤشر التفكير
function removeThinkingIndicator() {
    const thinkingDiv = document.getElementById('thinkingIndicator');
    if (thinkingDiv) {
        thinkingDiv.remove();
    }
}

// التمرير لأسفل المحادثة
function scrollToBottom() {
    const chatMessages = document.getElementById('chatMessages');
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// توليد رد المساعد الذكي
function generateAIResponse(question) {
    // تحليل السؤال لتحديد المجال
    const lowerQuestion = question.toLowerCase();
    
    // إجابات مسبقة للأسئلة الشائعة
    if (lowerQuestion.includes('نيوتن') || lowerQuestion.includes('قانون')) {
        return `بناءً على سؤالك عن القوانين الفيزيائية:

<strong>قوانين نيوتن للحركة:</strong>

1. <strong>قانون نيوتن الأول (قانون القصور الذاتي):</strong>
   "يبقى الجسم الساكن ساكناً، والجسم المتحرك في خط مستقيم بسرعة ثابتة يبقى على حالته، ما لم تؤثر عليه قوة خارجية تغير من حالته."

2. <strong>قانون نيوتن الثاني (قانون الحركة):</strong>
   "التسارع الذي يكتسبه الجسم يتناسب طردياً مع القوة المحصلة المؤثرة عليه، وعكسياً مع كتلته."
   <em>الصيغة الرياضية: F = m × a</em>

3. <strong>قانون نيوتن الثالث (الفعل ورد الفعل):</strong>
   "لكل فعل رد فعل مساوٍ له في المقدار ومعاكس له في الاتجاه."

هل تريد شرحاً مفصلاً لأي من هذه القوانين؟ 🤓`;
    }
    
    else if (lowerQuestion.includes('برمجة') || lowerQuestion.includes('كود') || lowerQuestion.includes('برنامج')) {
        return `فيما يخص سؤالك عن البرمجة:

<strong>مفاهيم أساسية في البرمجة:</strong>

1. <strong>المتغيرات (Variables):</strong> حاويات لتخزين البيانات.
2. <strong>الشروط (Conditions):</strong> if, else, switch لاتخاذ القرارات.
3. <strong>الحلقات (Loops):</strong> for, while لتكرار الأوامر.
4. <strong>الدوال (Functions):</strong> كتل من الأكواد قابلة لإعادة الاستخدام.

<strong>مثال بسيط في JavaScript:</strong>
\`\`\`javascript
// دالة لجمع رقمين
function جمع(أ, ب) {
    return أ + ب;
}

// استخدام الدالة
let النتيجة = جمع(5, 3);
console.log(النتيجة); // 8
\`\`\`

هل تريد مثالاً على موضوع برمجي محدد؟ 💻`;
    }
    
    else if (lowerQuestion.includes('رياض') || lowerQuestion.includes('معادلة') || lowerQuestion.includes('حساب')) {
        return `بالنسبة لسؤالك الرياضي:

<strong>أنواع المعادلات الأساسية:</strong>

1. <strong>المعادلات الخطية:</strong> ax + b = 0
2. <strong>المعادلات التربيعية:</strong> ax² + bx + c = 0
3. <strong>المعادلات التكعيبية:</strong> ax³ + bx² + cx + d = 0

<strong>مثال لحل معادلة تربيعية:</strong>
المعادلة: x² - 5x + 6 = 0

<strong>الحل:</strong>
1. التحليل: (x - 2)(x - 3) = 0
2. الحلول: x = 2 أو x = 3

<strong>التحقق:</strong>
عند x = 2: (2)² - 5(2) + 6 = 4 - 10 + 6 = 0 ✓
عند x = 3: (3)² - 5(3) + 6 = 9 - 15 + 6 = 0 ✓

هل تريد مساعدة في حل معادلة محددة؟ 🧮`;
    }
    
    else if (lowerQuestion.includes('شبك') || lowerQuestion.includes('انترنت') || lowerQuestion.includes('ip')) {
        return `بناءً على سؤالك عن الشبكات:

<strong>مفاهيم أساسية في الشبكات:</strong>

1. <strong>بروتوكول TCP/IP:</strong> مجموعة بروتوكولات أساسية للإنترنت.
2. <strong>عنوان IP:</strong> عنوان فريد لكل جهاز على الشبكة.
   - IPv4: 192.168.1.1 (32 بت)
   - IPv6: 2001:0db8:85a3::8a2e:0370:7334 (128 بت)
3. <strong>DNS:</strong> نظام يحول أسماء النطاقات إلى عناوين IP.
4. <strong>الراوتر:</strong> جهاز يوجه البيانات بين الشبكات.

<strong>طبقات نموذج OSI:</strong>
1. التطبيق 2. العرض 3. الجلسة 4. النقل 5. الشبكة 6. وصلة البيانات 7. المادية

هل تحتاج شرحاً مفصلاً لأي من هذه المفاهيم؟ 🌐`;
    }
    
    else if (lowerQuestion.includes('إلكترون') || lowerQuestion.includes('ديود') || lowerQuestion.includes('ترانزستور')) {
        return `بناءً على سؤالك عن الإلكترونيات:

<strong>مفاهيم أساسية في الإلكترونيات:</strong>

1. <strong>الدايود (الصمام الثنائي):</strong>
   - يسمح بمرور التيار في اتجاه واحد فقط
   - يستخدم في دوائر التقويم (تحويل AC إلى DC)
   - أنواعه: دايو د السليكون (0.7V) والجرمانيوم (0.3V)

2. <strong>الترانزستور:</strong>
   - مكون يستخدم للتضخيم والتحويل
   - له ثلاث أطراف: الباعث، القاعدة، المجمع
   - أنواعه: NPN و PNP

3. <strong>الدوائر المتكاملة (IC):</strong>
   - دوائر إلكترونية مصغرة على شريحة سليكون واحدة
   - تحتوي على آلاف أو ملايين الترانزستورات

هل تريد شرحاً مفصلاً لأي من هذه المكونات؟ 🔌`;
    }
    
    else {
        // رد عام إذا لم يتطابق مع المواضيع المعروفة
        return `شكراً لسؤالك! 🤖

سؤالك: "${question}"

أنا مساعد ذكي متخصص في المواد الدراسية لكلية الحاسبات والمعلومات. يمكنني مساعدتك في:

<strong>🔬 الفيزياء:</strong> قوانين نيوتن، الحركة، الطاقة، الكهرباء
<strong>🧮 الرياضيات:</strong> المعادلات، التفاضل، التكامل، الجبر
<strong>💻 البرمجة:</strong> أساسيات البرمجة، الخوارزميات، هياكل البيانات
<strong>🔌 الإلكترونيات:</strong> الدايود، الترانزستور، الدوائر المتكاملة
<strong>🌐 الشبكات:</strong> أساسيات الشبكات، البروتوكولات، الأمان

يمكنك صياغة سؤالك بشكل أكثر تحديداً للحصول على إجابة أدق، أو اختر أحد المواضيع المقترحة على اليسار.

هل يمكنك إعادة صياغة سؤالك أو اختيار موضوع محدد؟ 😊`;
    }
}

// سؤال مباشر من المواضيع المقترحة
function askAIQuestion(question) {
    document.getElementById('aiQuestionInput').value = question;
    sendAIQuestion();
}

// مسح المحادثة
function clearChat() {
    if (confirm('هل تريد مسح كل محادثتك مع المساعد الذكي؟')) {
        const chatMessages = document.getElementById('chatMessages');
        
        // الاحتفاظ على رسالة الترحيب الأولى فقط
        const welcomeMessage = chatMessages.querySelector('.ai-message');
        chatMessages.innerHTML = '';
        
        if (welcomeMessage) {
            chatMessages.appendChild(welcomeMessage);
        } else {
            // إضافة رسالة ترحيب إذا لم تكن موجودة
            addAIMessage('مرحباً! أنا المساعد الذكي للفضاء التعليمي. 👨‍🚀<br>كيف يمكنني مساعدتك اليوم في دراستك؟ يمكنك سؤالي عن أي موضوع في المنهج الدراسي.');
        }
        
        // مسح سجل المحادثة
        appData.aiChatHistory = [];
        
        showAlert('تم مسح المحادثة بنجاح', 'success');
    }
}

// إظهار تنبيه
function showAlert(message, type = 'info') {
    const alertContainer = document.getElementById('alertContainer');
    
    const alertDiv = document.createElement('div');
    alertDiv.className = `alert alert-${type}`;
    alertDiv.innerHTML = `
        <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'}"></i>
        <span>${message}</span>
    `;
    
    alertContainer.appendChild(alertDiv);
    
    // إزالة التنبيه بعد 5 ثوانٍ
    setTimeout(() => {
        alertDiv.style.animation = 'slideUp 0.3s ease';
        setTimeout(() => {
            alertDiv.remove();
        }, 300);
    }, 5000);
}

// ==========================================
// تهيئة الصفحة
// ==========================================

// دالة التأكد من أن جميع المستخدمين يرون نفس البيانات
function syncLeaderboard() {
    // هذه الدالة تضمن أن جميع المستخدمين في نفس المتصفح
    // يرون نفس بيانات المتصدرين (باستخدام localStorage)
    
    // عند أي تحديث للنتائج، يتم تحديث العرض للجميع
    window.addEventListener('storage', function(e) {
        if (e.key === GLOBAL_LEADERBOARD_KEY) {
            // تحديث العرض تلقائياً عند تغيير البيانات
            updateTopThreeChampions();
            updateChallengeLeaderboardTable();
            
            // إظهار إشعار بالتحديث
            const lbSection = document.getElementById('leaderboardSection');
            if (lbSection && lbSection.classList.contains('active')) {
                showAlert('تم تحديث قائمة المتصدرين!', 'info');
            }
        }
    });
}

// تهيئة أزرار نوع الامتحان
document.addEventListener('DOMContentLoaded', function() {
    // أزرار نوع الامتحان
    document.querySelectorAll('.exam-type-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            // إزالة النشط من جميع الأزرار
            document.querySelectorAll('.exam-type-btn').forEach(b => {
                b.classList.remove('active');
            });
            
            // إضافة النشط للزر المختار
            this.classList.add('active');
            
            // إخفاء جميع واجهات الامتحان
            document.querySelectorAll('.exam-interface').forEach(interface => {
                interface.classList.remove('active');
            });
            
            // إظهار الواجهة المختارة
            const examType = this.getAttribute('onclick').includes('challenge') ? 'challenge' : 'quick';
            document.getElementById(examType + 'Exam').classList.add('active');
        });
    });
    
    // أزرار مستوى الصعوبة
    document.querySelectorAll('.difficulty-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            // إزالة النشط من جميع الأزرار
            document.querySelectorAll('.difficulty-btn').forEach(b => {
                b.classList.remove('active');
            });
            
            // إضافة النشط للزر المختار
            this.classList.add('active');
        });
    });
    
    // السماح بإرسال سؤال AI بالضغط على Ctrl+Enter
    const aiInput = document.getElementById('aiQuestionInput');
    if (aiInput) {
        aiInput.addEventListener('keydown', function(e) {
            if (e.ctrlKey && e.key === 'Enter') {
                e.preventDefault();
                sendAIQuestion();
            }
        });
    }

    // دخول الأدمن (Enter للتأكيد)
    const adminCodeInput = document.getElementById('adminCodeInput');

    if (adminCodeInput) {
        adminCodeInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                verifyAdminAccess();
            }
        });
    }

    // ضبط قفل الأدمن في الإعدادات من البداية
    updateAdminGateUI();
    
    // استدعاء دالة التزامن عند التحميل
    syncLeaderboard();
});

// ==========================================
// Background Music (Header button: start music)
// ==========================================
// ملفات الموسيقى المتوقعة داخل مجلد المشروع: /music
// أمثلة: music/1.mp3, music/2.mp3, ... (يدعم mp3 / m4a / ogg / wav)

let __musicAudioEl = null;
let __musicIsRunning = false;
let __musicCurrentIndex = 1;
let __musicMissingStreak = 0;

const __musicExtensions = ['mp3', 'm4a', 'ogg', 'wav'];
const __musicMaxMissingStreak = 3; // بعد 3 أرقام غير موجودة متتالية هنقف بدل "لووب" على الفاضي

function initMusicPlayer() {
    if (__musicAudioEl) return;

    const existing = document.getElementById('bgMusicPlayer');
    if (existing) {
        __musicAudioEl = existing;
    } else {
        __musicAudioEl = document.createElement('audio');
        __musicAudioEl.id = 'bgMusicPlayer';
        __musicAudioEl.preload = 'none';
        __musicAudioEl.style.display = 'none';
        document.body.appendChild(__musicAudioEl);
    }

    // إعدادات افتراضية
    try { __musicAudioEl.volume = 0.7; } catch (e) {}

    // لما الأغنية تخلص نجيب اللي بعدها
    __musicAudioEl.addEventListener('ended', () => {
        if (!__musicIsRunning) return;
        __musicTryLoadAndPlay(__musicCurrentIndex + 1, 0);
    });
}

function __musicSetBtnState(isRunning) {
    const btn = document.getElementById('musicNavBtn');
    if (!btn) return;

    if (isRunning) {
        btn.classList.add('music-playing');
        btn.innerHTML = '<i class="fas fa-stop"></i> stop music';
    } else {
        btn.classList.remove('music-playing');
        btn.innerHTML = '<i class="fas fa-music"></i> start music';
    }
}

function __musicStop() {
    __musicIsRunning = false;
    __musicSetBtnState(false);

    if (__musicAudioEl) {
        try {
            __musicAudioEl.pause();
            __musicAudioEl.removeAttribute('src');
            __musicAudioEl.load();
        } catch (e) {}
    }
}

function __musicBuildUrl(index, ext) {
    return `music/${index}.${ext}`;
}

function __musicTryLoadAndPlay(index, extIndex) {
    if (!__musicIsRunning) return;

    initMusicPlayer();

    const audio = __musicAudioEl;
    const ext = __musicExtensions[extIndex] || 'mp3';
    const url = __musicBuildUrl(index, ext);

    // تنظيف listeners قبل ما نضيف جديد
    const cleanup = () => {
        try { audio.removeEventListener('loadedmetadata', onReady); } catch (e) {}
        try { audio.removeEventListener('canplay', onReady); } catch (e) {}
        try { audio.removeEventListener('error', onErr); } catch (e) {}
    };

    const onReady = () => {
        cleanup();
        if (!__musicIsRunning) return;

        __musicCurrentIndex = index;
        __musicMissingStreak = 0;

        const p = audio.play();
        if (p && typeof p.catch === 'function') {
            p.catch(() => {
                // ممكن متصفح يمنع التشغيل لو مفيش تفاعل كفاية
                if (typeof showAlert === 'function') {
                    showAlert('اضغط "start music" مرة تانية لتفعيل تشغيل الصوت 🔊', 'info');
                } else {
                    console.warn('Music play blocked by browser autoplay policy.');
                }
                __musicStop();
            });
        }
    };

    const onErr = () => {
        cleanup();
        if (!__musicIsRunning) return;

        // جرّب امتداد تاني لنفس الرقم
        if (extIndex + 1 < __musicExtensions.length) {
            __musicTryLoadAndPlay(index, extIndex + 1);
            return;
        }

        // كل الامتدادات فشلت -> نروح للرقم اللي بعده
        __musicMissingStreak += 1;

        if (__musicMissingStreak >= __musicMaxMissingStreak) {
            if (typeof showAlert === 'function') {
                showAlert('مش لاقي ملفات موسيقى كفاية داخل مجلد music (جرب تحط 1.mp3, 2.mp3, ...).', 'warning');
            } else {
                console.warn('Music files not found in /music.');
            }
            __musicStop();
            return;
        }

        __musicTryLoadAndPlay(index + 1, 0);
    };

    audio.addEventListener('loadedmetadata', onReady);
    audio.addEventListener('canplay', onReady);
    audio.addEventListener('error', onErr);

    try {
        audio.src = url;
        audio.load();
    } catch (e) {
        onErr();
    }
}

// زر الهيدر: start music
function toggleMusic() {
    initMusicPlayer();

    if (__musicIsRunning) {
        __musicStop();
        return;
    }

    __musicIsRunning = true;
    __musicCurrentIndex = 1;
    __musicMissingStreak = 0;

    __musicSetBtnState(true);

    __musicTryLoadAndPlay(__musicCurrentIndex, 0);
}

// لو الزر موجود اتأكد إن نصه مضبوط عند التحميل
document.addEventListener('DOMContentLoaded', () => {
    __musicSetBtnState(false);
});


// ==========================================
// تحكم متقدم في الموسيقى: ضغطه طويلة على زر start music
let __musicPopoverEl = null;
let __musicPopoverOpen = false;
let __musicPopoverScrubbing = false;

function __musicFormatTimeSec(sec) {
    const s = Math.max(0, Math.floor(Number(sec) || 0));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

function __musicEnsureRunning() {
    initMusicPlayer();
    __musicBindAudioPopoverEvents();

    if (__musicIsRunning) return true;

    // بدء التشغيل من آخر رقم معروف أو 1
    __musicIsRunning = true;
    __musicMissingStreak = 0;
    if (!Number.isInteger(__musicCurrentIndex) || __musicCurrentIndex < 1) {
        __musicCurrentIndex = 1;
    }
    __musicSetBtnState(true);

    __musicTryLoadAndPlay(__musicCurrentIndex, 0);
    return true;
}

function __musicGoTo(index) {
    const i = Math.max(1, parseInt(index, 10) || 1);
    __musicEnsureRunning();
    __musicMissingStreak = 0;
    __musicTryLoadAndPlay(i, 0);
}

function __musicSeekBy(deltaSeconds) {
    initMusicPlayer();
    __musicBindAudioPopoverEvents();

    const audio = __musicAudioEl;
    if (!audio) return;

    // لو مش شغّال هنشغّل الأول (الـ seek هيعتبر interaction)
    if (!__musicIsRunning) {
        __musicEnsureRunning();
    }

    const delta = Number(deltaSeconds) || 0;
    const duration = Number(audio.duration);
    const current = Number(audio.currentTime) || 0;

    let next = current + delta;
    if (Number.isFinite(duration) && duration > 0) {
        next = Math.max(0, Math.min(duration - 0.05, next));
    } else {
        next = Math.max(0, next);
    }

    try { audio.currentTime = next; } catch (e) {}
    __musicUpdatePopoverUI();
}

function __musicCreatePopoverIfNeeded() {
    if (__musicPopoverEl) return;

    __musicPopoverEl = document.createElement('div');
    __musicPopoverEl.id = 'musicPopover';
    __musicPopoverEl.className = 'music-popover';
    __musicPopoverEl.setAttribute('role', 'dialog');
    __musicPopoverEl.setAttribute('aria-label', 'تحكم الموسيقى');

    __musicPopoverEl.innerHTML = `
        <div class="music-popover-header">
            <div class="music-popover-title">
                <div class="music-title"><i class="fas fa-music"></i> تحكم الموسيقى</div>
                <div class="music-meta">الأغنية: <b id="musicTrackLabel">--</b> • <span id="musicTimeLabel" class="music-time">00:00 / 00:00</span></div>
            </div>
            <button type="button" class="music-popover-close" id="musicPopoverCloseBtn" title="إغلاق">
                <i class="fas fa-xmark"></i>
            </button>
        </div>

        <div class="music-popover-controls">
            <button type="button" class="music-ctl-btn" id="musicPrevBtn" title="السابق">
                <i class="fas fa-backward-step"></i> السابق
            </button>
            <button type="button" class="music-ctl-btn" id="musicNextBtn" title="التالي">
                التالي <i class="fas fa-forward-step"></i>
            </button>
        </div>

        <div class="music-popover-controls">
            <button type="button" class="music-ctl-btn" id="musicBack10Btn" title="ارجع 10 ثواني">
                <i class="fas fa-rotate-left"></i> -10ث
            </button>
            <button type="button" class="music-ctl-btn" id="musicFwd10Btn" title="قدّم 10 ثواني">
                +10ث <i class="fas fa-rotate-right"></i>
            </button>
        </div>

        <div class="music-popover-seek">
            <input type="range" id="musicSeekSlider" min="0" max="1000" value="0" step="1" aria-label="شريط التقديم والترجيع" />
        </div>
    `;

    document.body.appendChild(__musicPopoverEl);

    const closeBtn = document.getElementById('musicPopoverCloseBtn');
    if (closeBtn) closeBtn.addEventListener('click', __musicClosePopover);

    const prevBtn = document.getElementById('musicPrevBtn');
    const nextBtn = document.getElementById('musicNextBtn');
    const backBtn = document.getElementById('musicBack10Btn');
    const fwdBtn = document.getElementById('musicFwd10Btn');
    const slider = document.getElementById('musicSeekSlider');

    if (prevBtn) prevBtn.addEventListener('click', () => __musicGoTo(Math.max(1, (__musicCurrentIndex || 1) - 1)));
    if (nextBtn) nextBtn.addEventListener('click', () => __musicGoTo((__musicCurrentIndex || 1) + 1));
    if (backBtn) backBtn.addEventListener('click', () => __musicSeekBy(-10));
    if (fwdBtn) fwdBtn.addEventListener('click', () => __musicSeekBy(10));

    if (slider) {
        slider.addEventListener('input', () => {
            initMusicPlayer();
            __musicBindAudioPopoverEvents();
            const audio = __musicAudioEl;
            if (!audio) return;

            const dur = Number(audio.duration);
            if (!Number.isFinite(dur) || dur <= 0) return;

            __musicPopoverScrubbing = true;
            const v = Number(slider.value) || 0;
            const t = (v / 1000) * dur;
            try { audio.currentTime = t; } catch (e) {}
            __musicUpdatePopoverUI();
        });

        slider.addEventListener('change', () => {
            // ادي فرصة بسيطة للـ timeupdate يمسك بعد ما المستخدم يسيب السلايدر
            setTimeout(() => { __musicPopoverScrubbing = false; }, 120);
        });
    }

    // إغلاق عند الضغط برا
    if (!window.__musicOutsideCloseBound) {
        window.__musicOutsideCloseBound = true;

        window.addEventListener('pointerdown', (e) => {
            if (!__musicPopoverOpen) return;

            const btn = document.getElementById('musicNavBtn');
            const target = e.target;

            if (__musicPopoverEl && __musicPopoverEl.contains(target)) return;
            if (btn && btn.contains(target)) return;

            __musicClosePopover();
        }, true);

        window.addEventListener('keydown', (e) => {
            if (!__musicPopoverOpen) return;
            if (e.key === 'Escape') __musicClosePopover();
        });

        window.addEventListener('resize', () => {
            if (__musicPopoverOpen) __musicPositionPopover();
        });

        window.addEventListener('scroll', () => {
            if (__musicPopoverOpen) __musicPositionPopover();
        }, true);
    }
}

function __musicPositionPopover() {
    if (!__musicPopoverEl) return;
    const btn = document.getElementById('musicNavBtn');
    if (!btn) return;

    const rect = btn.getBoundingClientRect();
    const padding = 10;
    const gap = 10;

    // في RTL: خليها قريبة من يمين الزر
    const right = Math.max(padding, (window.innerWidth - rect.right));
    let top = rect.bottom + gap;

    __musicPopoverEl.style.right = `${right}px`;
    __musicPopoverEl.style.left = 'auto';

    const estimatedHeight = __musicPopoverEl.offsetHeight || 240;

    // لو هتنزل برا الشاشة من تحت، اطلع لفوق
    const placeAbove = (top + estimatedHeight + padding > window.innerHeight);
    if (placeAbove) {
        top = Math.max(padding, rect.top - estimatedHeight - gap);
        __musicPopoverEl.classList.add('above');
    } else {
        __musicPopoverEl.classList.remove('above');
    }

    __musicPopoverEl.style.top = `${top}px`;
}

function __musicOpenPopover() {
    __musicCreatePopoverIfNeeded();
    __musicPositionPopover();
    __musicPopoverEl.classList.add('open');
    __musicPopoverOpen = true;

    // تحديث UI (حتى لو الموسيقى مش شغالة)
    __musicUpdatePopoverUI();
}

function __musicClosePopover() {
    if (!__musicPopoverEl) return;
    __musicPopoverEl.classList.remove('open');
    __musicPopoverOpen = false;
}

function __musicUpdatePopoverUI() {
    if (!__musicPopoverEl) return;

    const trackLabel = document.getElementById('musicTrackLabel');
    const timeLabel = document.getElementById('musicTimeLabel');
    const slider = document.getElementById('musicSeekSlider');

    if (trackLabel) trackLabel.textContent = String(__musicCurrentIndex || 1);

    initMusicPlayer();
    __musicBindAudioPopoverEvents();

    const audio = __musicAudioEl;
    const cur = audio ? (Number(audio.currentTime) || 0) : 0;
    const dur = audio ? Number(audio.duration) : NaN;

    if (timeLabel) {
        const dStr = (Number.isFinite(dur) && dur > 0) ? __musicFormatTimeSec(dur) : '--:--';
        timeLabel.textContent = `${__musicFormatTimeSec(cur)} / ${dStr}`;
    }

    if (slider && !__musicPopoverScrubbing) {
        if (Number.isFinite(dur) && dur > 0) {
            slider.disabled = false;
            slider.value = String(Math.round((cur / dur) * 1000));
        } else {
            slider.disabled = true;
            slider.value = '0';
        }
    }
}

function __musicBindAudioPopoverEvents() {
    initMusicPlayer();
    const audio = __musicAudioEl;
    if (!audio || audio.__popoverBound) return;

    audio.__popoverBound = true;
    audio.addEventListener('timeupdate', () => {
        if (__musicPopoverOpen) __musicUpdatePopoverUI();
    });
    audio.addEventListener('loadedmetadata', () => {
        if (__musicPopoverOpen) __musicUpdatePopoverUI();
    });
    audio.addEventListener('durationchange', () => {
        if (__musicPopoverOpen) __musicUpdatePopoverUI();
    });
}

function __musicBindLongPressOnNavBtn() {
    const btn = document.getElementById('musicNavBtn');
    if (!btn || btn.__musicLongPressBound) return;

    btn.__musicLongPressBound = true;

    // لو لسه في onclick من HTML شيله
    try { btn.onclick = null; btn.removeAttribute('onclick'); } catch (e) {}

    const LONG_PRESS_MS = 520;
    let pressTimer = null;
    let longPressed = false;

    const clearPress = () => {
        if (pressTimer) {
            clearTimeout(pressTimer);
            pressTimer = null;
        }
    };

    const startPress = (e) => {
        longPressed = false;
        clearPress();

        // منع الـ context menu على الموبايل
        if (e && typeof e.preventDefault === 'function') e.preventDefault();

        pressTimer = setTimeout(() => {
            longPressed = true;
            __musicOpenPopover();
        }, LONG_PRESS_MS);
    };

    const endPress = (e) => {
        clearPress();

        if (longPressed) {
            // ما تشغلش / توقفش الموسيقى بعد ضغطه طويلة
            if (e && typeof e.preventDefault === 'function') e.preventDefault();
            if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
            return;
        }

        // ضغطه قصيرة => تشغيل/إيقاف
        toggleMusic();
    };

    // Pointer Events (أفضل)
    if (window.PointerEvent) {
        btn.addEventListener('pointerdown', startPress, { passive: false });
        btn.addEventListener('pointerup', endPress, { passive: false });
        btn.addEventListener('pointercancel', clearPress);
        btn.addEventListener('pointerleave', clearPress);
    } else {
        // fallback
        btn.addEventListener('mousedown', startPress);
        btn.addEventListener('mouseup', endPress);
        btn.addEventListener('mouseleave', clearPress);

        btn.addEventListener('touchstart', startPress, { passive: false });
        btn.addEventListener('touchend', endPress, { passive: false });
        btn.addEventListener('touchcancel', clearPress);
    }

    // Keyboard accessibility
    btn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggleMusic();
        }
    });

    btn.addEventListener('contextmenu', (e) => {
        // منع القائمة اللي بتظهر في الموبايل مع الضغط الطويل
        if (!__musicPopoverOpen) e.preventDefault();
    });
}

document.addEventListener('DOMContentLoaded', () => {
    __musicBindLongPressOnNavBtn();
});


// ==========================================
// Summary Overlay (علشان الموسيقى متقفش لما تفتح صفحة الملخصات أو أي روابط)
// الفكرة: بدل ما نروح لـ summary.html في نفس التبويب (وده بيوقف الصوت)،
 // بنفتحها داخل Overlay + iframe فوق الصفحة الرئيسية، فالموسيقى تفضل شغالة.

let __summaryOverlayEl = null;
let __summaryOverlayFrame = null;
let __summaryOverlayOpen = false;
let __summaryOverlayLastFocus = null;

function __summaryShouldKeepDefaultClick(e) {
    // لو المستخدم عايز يفتح في تبويب جديد (Ctrl/⌘/Shift/عجلة الماوس) نخليه كما هو
    if (!e) return false;
    return !!(e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button === 1);
}

function __summaryEnsureOverlay() {
    if (__summaryOverlayEl) return;

    const overlay = document.createElement('div');
    overlay.id = 'summaryOverlay';
    overlay.className = 'summary-overlay';

    const panel = document.createElement('div');
    panel.className = 'summary-overlay-panel';

    const header = document.createElement('div');
    header.className = 'summary-overlay-header';

    const title = document.createElement('div');
    title.className = 'summary-overlay-title';
    title.innerHTML = '<i class="fas fa-file-alt"></i><span>الملخصات</span>';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'summary-overlay-close';
    closeBtn.innerHTML = '<i class="fas fa-times"></i>';
    closeBtn.title = 'إغلاق';

    closeBtn.addEventListener('click', () => {
        __summaryCloseOverlay();
    });

    header.appendChild(title);
    header.appendChild(closeBtn);

    const frame = document.createElement('iframe');
    frame.className = 'summary-overlay-frame';
    frame.id = 'summaryOverlayFrame';
    frame.setAttribute('loading', 'lazy');

    // لو الصفحة داخل iframe فيها روابط خارجية، افتحها في تبويب جديد علشان مشاكل الـ iframe (X-Frame-Options)
    frame.addEventListener('load', () => {
        try {
            const doc = frame.contentDocument;
            if (!doc) return;
            // امنع تكرار البايند كل مرة
            if (doc.__summaryLinkBound) return;
            doc.__summaryLinkBound = true;

            doc.addEventListener('click', (ev) => {
                const a = ev.target && ev.target.closest ? ev.target.closest('a[href]') : null;
                if (!a) return;

                // لو already target=_blank سيبه
                const targetAttr = String(a.getAttribute('target') || '').toLowerCase();
                if (targetAttr === '_blank') return;

                const href = String(a.getAttribute('href') || '').trim();
                if (!href) return;

                let url;
                try {
                    url = new URL(href, frame.contentWindow.location.href);
                } catch {
                    return;
                }

                // لو خارج الدومين افتح في تبويب جديد
                if (url.origin && url.origin !== window.location.origin) {
                    // حافظ على اختيارات المستخدم (فتح تبويب جديد يدوي)
                    if (__summaryShouldKeepDefaultClick(ev)) return;

                    ev.preventDefault();
                    try {
                        window.open(url.href, '_blank', 'noopener');
                    } catch {
                        // fallback
                        window.location.href = url.href;
                    }
                }
            }, true);
        } catch (e) {
            // cross-origin: ما نقدرش نلمس DOM
        }
    });

    panel.appendChild(header);
    panel.appendChild(frame);

    // إغلاق عند الضغط على الخلفية
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) __summaryCloseOverlay();
    });

    // إغلاق بـ ESC
    document.addEventListener('keydown', (e) => {
        if (!__summaryOverlayOpen) return;
        if (e.key === 'Escape') __summaryCloseOverlay();
    });

    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    __summaryOverlayEl = overlay;
    __summaryOverlayFrame = frame;
}

function __summaryOpenOverlay(url = 'summary.html') {
    __summaryEnsureOverlay();

    __summaryOverlayLastFocus = document.activeElement;
    __summaryOverlayOpen = true;

    if (__summaryOverlayEl) {
        __summaryOverlayEl.classList.add('open');
    }
    try { document.body.classList.add('summary-overlay-open'); } catch {}

    if (__summaryOverlayFrame) {
        // لو نفس الصفحة مفتوحة، ما نعيدش تحميلها
        const current = String(__summaryOverlayFrame.getAttribute('src') || '');
        if (current !== String(url)) {
            __summaryOverlayFrame.setAttribute('src', String(url));
        }
    }

    // حط فوكس للـ iframe بعد فتحه
    setTimeout(() => {
        try { __summaryOverlayFrame && __summaryOverlayFrame.focus(); } catch {}
    }, 50);
}

function __summaryCloseOverlay() {
    __summaryOverlayOpen = false;
    if (__summaryOverlayEl) {
        __summaryOverlayEl.classList.remove('open');
    }
    try { document.body.classList.remove('summary-overlay-open'); } catch {}

    if (__summaryOverlayLastFocus && typeof __summaryOverlayLastFocus.focus === 'function') {
        try { __summaryOverlayLastFocus.focus(); } catch {}
    }
    __summaryOverlayLastFocus = null;
}

function __summaryBindSummaryLinks() {
    // كل روابط الملخصات في الصفحة الرئيسية (index.html)
    const links = document.querySelectorAll('a[href="summary.html"], a[href="./summary.html"]');
    if (!links || links.length === 0) return;

    links.forEach((a) => {
        if (a.dataset && a.dataset.summaryBound === '1') return;
        if (a.dataset) a.dataset.summaryBound = '1';

        a.addEventListener('click', (e) => {
            if (__summaryShouldKeepDefaultClick(e)) return;

            e.preventDefault();
            // افتح داخل Overlay بدل التنقل
            __summaryOpenOverlay('summary.html');
        });
    });
}

document.addEventListener('DOMContentLoaded', () => {
    __summaryBindSummaryLinks();
});



// ==========================================
// Mobile Navbar (قائمة موبايل مقفولة + زر 3 شرط)
// - مقفولة افتراضياً على الشاشات الصغيرة
// - بتفتح/تقفل بزرار القائمة فقط
// - مابتتقفلش لوحدها لما تختار قسم

function __setMobileNavbarOpen(isOpen) {
    const navbar = document.querySelector('.space-navbar');
    const btn = document.getElementById('mobileMenuBtn');
    if (!navbar || !btn) return;

    navbar.classList.toggle('menu-open', !!isOpen);

    btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');

    const icon = btn.querySelector('i');
    if (icon) {
        icon.className = isOpen ? 'fas fa-xmark' : 'fas fa-bars';
    }
}

function __bindMobileNavbarToggle() {
    const btn = document.getElementById('mobileMenuBtn');
    const navbar = document.querySelector('.space-navbar');
    if (!btn || !navbar) return;

    // تأكد إنها مقفولة افتراضياً
    __setMobileNavbarOpen(false);

    btn.addEventListener('click', (e) => {
        e.preventDefault();
        const isOpen = navbar.classList.contains('menu-open');
        __setMobileNavbarOpen(!isOpen);
    });

    // لو خرجنا من وضع الموبايل، اقفلها (علشان ما تفضل class موجودة)
    window.addEventListener('resize', () => {
        const isMobile = window.matchMedia('(max-width: 768px)').matches;
        if (!isMobile) __setMobileNavbarOpen(false);
    });
}

document.addEventListener('DOMContentLoaded', () => {
    __bindMobileNavbarToggle();
});
