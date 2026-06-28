import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  addDoc,
  collection,
  query,
  where,
  orderBy,
  getDocs,
  serverTimestamp,
  Timestamp,
  arrayUnion,
  arrayRemove
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const FIREBASE_CONFIG = window.CARELEARN_FIREBASE_CONFIG;
const DEFAULT_CERTIFICATE_GENERATOR_URL = 'https://script.google.com/macros/s/AKfycbyStOtsebTgIq1BeBZ0pqBLDuR57Yb3XmjL5ZMEJ9A8SREquDUDOUyIhVC9vRC_V7-P/exec';
const DEFAULT_APPS_SCRIPT_EXPORT_URL = 'https://script.google.com/macros/s/AKfycbxIiax1SPtg5cORDb-SHRqm9LT-R9bmH_f7WgeopKsKBCFqZRif30Fb3tevFJ1cs9C7/exec';
if (!FIREBASE_CONFIG?.apiKey) {
  throw new Error('Missing Firebase config. Copy public/firebase-config.example.js to public/firebase-config.js and fill your Firebase web config.');
}

const DEFAULT_DEPARTMENTS = [
  'Emergency Nursing Department','ICU Nursing Department','CCU Nursing Department','Emergency Physician Department','ICU Physician Department','CCU Physician Department','IPC Department','Quality Department','Radiology Department','Medical Records Department','Reception Department','Social Services Department','House Keeping Department','Pharmacy Department','IT Department','Respiratory Therapy','Supply Chain Department','Safety & Security Department','Physical Therapy Department','Operation Services Department','Laboratory Department'
];
const DEFAULT_PROFESSIONS = [
  'Housekeeper','Staff Nurse','Social Worker','Laboratory Head','Laboratory Specialist','Executive Secretary','HR Coordinator','Medical Approval Coordinator','Quality & Patient Safety specialist','HR Officer','Medical records specialist','Receptionist','Pharmacist','Respiratory Therapy Specialist','Driver','General Practitioner','Security Guard','Senior Registrar ER Physician','Infection Control Specialist','Nursing Supervisor','Registrar Anesthesia','Porter','Admin Director','Shift Supervisor','Duty Manager','Registrar ER Physician','Radiology Registrar','Clinical Nutritionist','Senior Registrar Orthopedic Surgeon','Encoder','Registrar Internal Medicine','Radiology Specialist','Supervisor','AC Technician','Electrician Technician','Plumber','Accountant','IT Helpdesk','Gas Technican','Physical Therapist','Consultant Critical Care Medicine','Head Ambulatory & Emergency Care/ Senior Registrar ER physician','Registrar ICU','Registrar Cardiology'
];

const app = initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });

const state = {
  user: null,
  profile: null,
  courses: [],
  courseNameIndex: [],
  attendance: [],
  users: [],
  courseRequests: [],
  activePage: 'dashboard',
  currentCourse: null,
  currentQuiz: [],
  activeSeconds: 0,
  timer: null,
  startedAt: null,
  signatureDirty: false,
  signatureHasInk: false,
  canvasReady: false,
  signatureCtx: null,
  drawing: false,
  questionsDraft: [],
  plannerMonthOffset: 0,
  featureSliderTimer: null,
  featureSliderIndex: 0,
  attendanceAudit: {
    timer: null,
    running: false,
    courseId: '',
    lastCount: 0,
    lastActivityAt: null,
    startedAt: null,
    checks: 0,
    rows: []
  }
};

const $ = (id) => document.getElementById(id);
const qsa = (sel) => Array.from(document.querySelectorAll(sel));
const adminRoles = ['SuperAdmin','Super Admin','Admin','TrainingAdmin','Training Admin'];
const superAdminRoles = ['SuperAdmin','Super Admin'];
const courseManagerRoles = ['CourseManager','Course Manager','CoursePublisher','Course Publisher','Publisher'];
const rolesCanManage = [
  ...adminRoles,
  'Manager','DepartmentHead','Department Head','CourseBuilder','Course Builder','Head',
  ...courseManagerRoles
];
const rolesCanReport = rolesCanManage;
const roleLabels = {
  SuperAdmin: 'Super Admin',
  'Super Admin': 'Super Admin',
  TrainingAdmin: 'Training Admin',
  'Training Admin': 'Training Admin',
  DepartmentHead: 'Department Head',
  'Department Head': 'Department Head',
  CourseBuilder: 'Course Builder',
  'Course Builder': 'Course Builder',
  CourseManager: 'Course Manager',
  'Course Manager': 'Course Manager',
  CoursePublisher: 'Course Publisher',
  'Course Publisher': 'Course Publisher'
};

function toast(msg, type='') {
  const el = $('toast');
  el.textContent = msg;
  el.className = `toast show ${type}`;
  setTimeout(() => el.className = 'toast', 4500);
}
function showLoader(percent, msg) {
  $('loader').classList.remove('hidden');
  $('loaderPercent').textContent = `${Math.round(percent)}%`;
  $('loaderMsg').textContent = msg;
  $('loaderBar').style.width = `${Math.round(percent)}%`;
}
function hideLoader() { setTimeout(() => $('loader').classList.add('hidden'), 250); }
function escapeHtml(v) { return String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function todayIso() { return new Date().toISOString(); }
function dateOnly(d) { const x = d instanceof Date ? d : toDate(d); return x ? x.toISOString().slice(0,10) : ''; }
function timeOnly(d) { const x = d instanceof Date ? d : toDate(d); return x ? x.toLocaleTimeString('en-GB', {hour12:false}) : ''; }

function courseDateValue(course) {
  return dateOnly(course?.courseDate || course?.postedDate || course?.availableFrom || course?.createdAt) || dateOnly(new Date());
}
function courseDateLabel(course) {
  return courseDateValue(course) || 'Not scheduled';
}
function departmentTooltip(departments) {
  const deps = unique(departments || []);
  if (!deps.length) return '<span class="muted">No departments</span>';
  return `<span class="tooltip-wrap"><button type="button" class="info-circle" aria-label="View departments"><span>i</span></button><span class="tooltip-panel tooltip-list">${deps.map(d => `<div>- ${escapeHtml(d)}</div>`).join('')}</span></span>`;
}
function courseStatusClass(course) {
  return course.completed ? 'completed' : course.isDue ? 'due' : isCourseMember(course) ? 'pending' : 'locked';
}
function courseStatusLabel(course) {
  return course.completed ? 'Completed' : course.isDue ? 'Due' : isCourseMember(course) ? 'Pending' : 'Request Required';
}
function passDisplay(course) {
  const questions = course?.questions || [];
  if (!questions.length && course?.completed) return '100%';
  return `${Number(course?.passScore || 0)}%`;
}



function appsScriptExportUrl() {
  return String(
    window.CARELEARN_APPS_SCRIPT_EXPORT_URL ||
    localStorage.getItem('carelearn.appsScriptUrl') ||
    $('appsScriptUrl')?.value ||
    DEFAULT_APPS_SCRIPT_EXPORT_URL ||
    ''
  ).trim();
}

function courseCertificateTemplateUrl(course) {
  return String(course?.certificateTemplateUrl || course?.certificateSlidesUrl || course?.certificateTemplate || '').trim();
}
function courseHasCertificate(course) {
  return !!courseCertificateTemplateUrl(course);
}
function certificateGeneratorUrl(course={}) {
  return String(
    window.CARELEARN_CERTIFICATE_WEBAPP_URL ||
    course?.certificateGeneratorUrl ||
    localStorage.getItem('carelearn.certificateScriptUrl') ||
    $('certificateScriptUrl')?.value ||
    DEFAULT_CERTIFICATE_GENERATOR_URL ||
    ''
  ).trim();
}
function b64Json(payload) {
  return btoa(unescape(encodeURIComponent(JSON.stringify(payload)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function isOwnAttendanceRecord(record) {
  if (!record || !state.user) return false;
  const email = String(state.user.email || '').toLowerCase();
  return (
    record.userId === state.user.uid ||
    String(record.email || '').toLowerCase() === email ||
    String(record.userEmail || '').toLowerCase() === email
  );
}
function courseCompletionRecordForUser(course) {
  if (!course || !state.user) return null;
  const cycle = course.cycleKey || currentCycle(course);
  const attendanceId = `${state.user.uid}_${course.id}_${cycle}`;
  return state.attendance.find(record =>
    record.courseId === course.id &&
    isOwnAttendanceRecord(record) &&
    (
      record.id === attendanceId ||
      String(record.cycle || '') === cycle ||
      (cycle === 'ONE-TIME' && (!record.cycle || record.cycle === 'ONE-TIME'))
    )
  ) || null;
}

function certificateRecordForCourse(course) {
  return course?.completedRecord || courseCompletionRecordForUser(course);
}
function certificatePayload(course, record=null) {
  const rec = record || certificateRecordForCourse(course) || {};
  const completedAt = toDate(rec.completedAt) || new Date();
  const duration = Number(rec.durationMinutes || rec.duration || 0);
  const certificateId = rec.certificateId || `${state.user?.uid || 'user'}_${course?.id || 'course'}_${rec.cycle || course?.cycleKey || currentCycle(course || {})}`;
  return {
    name: rec.name || state.profile?.name || state.user?.displayName || state.user?.email || '',
    course: course?.courseName || rec.courseName || '',
    date: dateOnly(completedAt),
    jobId: rec.jobId || state.profile?.jobId || '',
    department: rec.department || state.profile?.primaryDepartment || (state.profile?.departments || [])[0] || course?.department || '',
    profession: rec.profession || state.profile?.profession || '',
    score: String(rec.score ?? ''),
    duration: `${duration} min`,
    publisher: coursePublisherName(course || {}),
    cycle: rec.cycle || course?.cycle || '',
    certificateId,
    publisherSignature: coursePublisherSignatureDataUrl(course || {}),
    managerSignature: coursePublisherSignatureDataUrl(course || {}),
    signatureAvailable: !!coursePublisherSignatureDataUrl(course || {}),
    outputMode: 'image-and-pdf'
  };
}
function certificateDownloadUrl(course, record=null) {
  const scriptUrl = certificateGeneratorUrl(course);
  if (!scriptUrl || !courseHasCertificate(course)) return '';
  const params = new URLSearchParams();
  params.set('templateUrl', courseCertificateTemplateUrl(course));
  params.set('payload', b64Json(certificatePayload(course, record)));
  return `${scriptUrl}${scriptUrl.includes('?') ? '&' : '?'}${params.toString()}`;
}
function submitCertificateRequest(course, record=null) {
  const scriptUrl = certificateGeneratorUrl(course);
  if (!scriptUrl || !courseHasCertificate(course)) return false;
  const form = document.createElement('form');
  form.method = 'post';
  form.action = scriptUrl;
  form.target = '_blank';
  form.className = 'hidden';

  const templateInput = document.createElement('input');
  templateInput.type = 'hidden';
  templateInput.name = 'templateUrl';
  templateInput.value = courseCertificateTemplateUrl(course);
  form.appendChild(templateInput);

  const payloadInput = document.createElement('input');
  payloadInput.type = 'hidden';
  payloadInput.name = 'payload';
  payloadInput.value = b64Json(certificatePayload(course, record));
  form.appendChild(payloadInput);

  document.body.appendChild(form);
  form.submit();
  setTimeout(() => form.remove(), 1500);
  return true;
}

function downloadCertificate(courseId) {
  const course = state.courses.find(c => c.id === courseId) || state.currentCourse;
  if (!course) return toast('Course not found.', 'error');
  if (!course.completed) return toast('Certificate is available only after course completion.', 'warn');
  if (!courseHasCertificate(course)) return toast('No certificate template linked to this course.', 'warn');
  const ok = submitCertificateRequest(course, certificateRecordForCourse(course));
  if (!ok) return toast('Certificate Generator URL is not available.', 'warn');
}
function courseCertificateActionHtml(course) {
  if (!course?.completed || !courseHasCertificate(course)) return '';
  return `<div class="course-certificate-actions"><button type="button" class="btn success download-certificate" data-id="${escapeHtml(course.id)}">Download Certificate</button></div>`;
}
function renderCertificateBox(course) {
  const box = $('certificateBox');
  if (!box) return;
  const show = !!course?.completed && courseHasCertificate(course);
  box.classList.toggle('hidden', !show);
  if (!show) {
    box.innerHTML = '';
    return;
  }
  box.innerHTML = `
    <strong>Certificate Available</strong>
    <p>Your certificate is generated from your own completion record only. The course remains available for other assigned members.</p>
    <button type="button" class="btn success download-certificate" data-id="${escapeHtml(course.id)}">Download Certificate</button>`;
  bindCertificateButtons();
}
function bindCertificateButtons() {
  qsa('.download-certificate').forEach(btn => {
    if (btn.dataset.certificateBound === '1') return;
    btn.dataset.certificateBound = '1';
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      downloadCertificate(btn.dataset.id);
    });
  });
}

function shortDisplayName(value='') {
  let raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.includes('@')) raw = raw.split('@')[0].replace(/[._-]+/g, ' ');
  const parts = raw.replace(/\s+/g, ' ').split(' ').filter(Boolean);
  if (!parts.length) return '';
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1]}`;
}
function coursePublisherUser(course) {
  const ids = [course?.publisherUid, course?.postedByUid, course?.managerUid, course?.createdByUid].filter(Boolean);
  const emails = [course?.publisherEmail, course?.postedByEmail, course?.managerEmail, course?.createdBy, course?.createdByEmail].filter(Boolean).map(v => String(v).toLowerCase());
  return state.users.find(user =>
    ids.includes(user.id) ||
    emails.includes(String(user.email || '').toLowerCase())
  ) || null;
}
function coursePublisherName(course) {
  const user = coursePublisherUser(course);
  return shortDisplayName(
    course?.publisherName ||
    course?.postedByName ||
    course?.createdByName ||
    course?.managerName ||
    user?.name ||
    user?.displayName ||
    user?.email ||
    course?.publisherEmail ||
    course?.managerEmail ||
    course?.createdBy ||
    'CareLearn Admin'
  ) || 'CareLearn Admin';
}

function publisherLibraryDepartment(user) {
  if (!user) return '';
  return String(user.publisherLibraryDepartment || user.libraryDepartment || user.courseLibraryDepartment || user.primaryDepartment || (user.departments || [])[0] || '').trim();
}
function courseLibraryDepartment(course) {
  const user = coursePublisherUser(course);
  return String(
    course?.publisherLibraryDepartment ||
    course?.libraryDepartment ||
    course?.courseLibraryDepartment ||
    course?.publisherDepartment ||
    course?.postedByDepartment ||
    course?.createdByDepartment ||
    publisherLibraryDepartment(user) ||
    coursePublisherDepartment(course) ||
    'Unclassified'
  ).trim() || 'Unclassified';
}
function libraryDepartmentOptions() {
  return unique([
    ...DEFAULT_DEPARTMENTS,
    ...state.users.map(publisherLibraryDepartment),
    ...state.courses.map(courseLibraryDepartment)
  ]).sort((a, b) => a.localeCompare(b));
}

function coursePublisherSignatureDataUrl(course) {
  const user = coursePublisherUser(course);
  return String(
    course?.publisherSignatureDataUrl ||
    course?.publisherSignature ||
    course?.managerSignatureDataUrl ||
    course?.signatureDataUrl ||
    user?.signatureDataUrl ||
    ''
  ).trim();
}

function coursePublisherDepartment(course) {
  const user = coursePublisherUser(course);
  return course?.publisherDepartment ||
    course?.postedByDepartment ||
    course?.createdByDepartment ||
    user?.primaryDepartment ||
    (user?.departments || [])[0] ||
    course?.department ||
    (courseDepartments(course) || [])[0] ||
    'Not specified';
}


async function syncPublisherSignatureToOwnedCourses() {
  const signature = String(state.profile?.signatureDataUrl || '').trim();
  if (!state.user || !signature) return;
  const targets = state.courses.filter(course =>
    isCourseOriginalPublisher(course) &&
    !String(course.publisherSignatureDataUrl || course.publisherSignature || course.managerSignatureDataUrl || '').trim()
  );
  for (const course of targets) {
    try {
      await updateDoc(doc(db, 'courses', course.id), {
        publisherSignatureDataUrl: signature,
        publisherSignatureSyncedAt: serverTimestamp()
      });
      course.publisherSignatureDataUrl = signature;
    } catch (e) {
      await logClient('syncPublisherSignatureToOwnedCourses', e.message || String(e), { courseId: course.id });
    }
  }
}

async function hydrateCoursePublisherUsers(courses=[]) {
  const ids = unique(courses.flatMap(course => [
    course?.publisherUid,
    course?.postedByUid,
    course?.managerUid,
    course?.createdByUid
  ]));
  const existing = new Set(state.users.map(user => user.id));
  for (const uid of ids) {
    if (!uid || existing.has(uid)) continue;
    try {
      const snap = await getDoc(doc(db, 'users', uid));
      if (snap.exists()) {
        state.users.push({ id: snap.id, ...snap.data() });
        existing.add(uid);
      }
    } catch (e) {
      await logClient('hydrateCoursePublisherUsers', e.message || String(e), { uid });
    }
  }
}
function toDate(v) {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (v instanceof Timestamp) return v.toDate();
  if (v.toDate) return v.toDate();
  const d = new Date(v);
  return isNaN(d) ? null : d;
}
function mmss(sec) { sec = Math.max(0, Math.floor(sec || 0)); return `${String(Math.floor(sec/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`; }
function currentCycle(course) {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth()+1).padStart(2,'0');
  const q = Math.floor(now.getMonth()/3)+1;
  const c = String(course.cycle || 'One Time').toLowerCase();
  if (c === 'monthly') return `${y}-${m}`;
  if (c === 'quarterly') return `${y}-Q${q}`;
  if (c === 'semi annual') return `${y}-H${now.getMonth()<6?1:2}`;
  if (c === 'annual' || c === 'yearly') return `${y}`;
  return 'ONE-TIME';
}
function roleOf(profile=state.profile) { return profile?.role || 'User'; }
function canonicalRole(role) {
  if (superAdminRoles.includes(role)) return 'SuperAdmin';
  if (role === 'Training Admin') return 'TrainingAdmin';
  if (role === 'Department Head') return 'DepartmentHead';
  if (role === 'Course Builder') return 'CourseBuilder';
  if (courseManagerRoles.includes(role)) return 'CourseManager';
  return role || 'User';
}
function isCourseManagerRole(profile=state.profile) { return courseManagerRoles.includes(roleOf(profile)); }
function accessDepartments(user=state.profile) {
  return unique([...(user?.managedDepartments || []), ...(user?.departments || [])]);
}
function isManager() { return state.profile && rolesCanReport.includes(roleOf()); }
function canManageCourses() { return state.profile && rolesCanManage.includes(roleOf()); }
function isSuperAdmin() { return superAdminRoles.includes(roleOf()); }
function isAdminRole() { return state.profile && adminRoles.includes(roleOf()); }
function canManageDepartment(dep) {
  if (!state.profile) return false;
  if (isAdminRole()) return true;
  return accessDepartments().includes(dep);
}
function permittedDepartments() {
  if (!state.profile) return [];
  if (isAdminRole()) return DEFAULT_DEPARTMENTS;
  return accessDepartments();
}
function userBelongsToDepartment(user, department) {
  return user?.primaryDepartment === department || (user?.departments || []).includes(department);
}
function userRegisteredInDepartment(user, department) {
  return user?.primaryDepartment ? user.primaryDepartment === department : (user?.departments || []).includes(department);
}
function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}
function normalizeCourseName(name) {
  return String(name || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}
function stableCourseIdFromName(name) {
  const key = normalizeCourseName(name);
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `course_${(hash >>> 0).toString(36)}`;
}
function activeSystemUsersForDepartment(department) {
  return state.users.filter(user =>
    (user.status || 'Active') !== 'Inactive' &&
    !superAdminRoles.includes(user.role) &&
    userRegisteredInDepartment(user, department)
  );
}
function attendanceMatchesCourseCycle(record, course) {
  return record.courseId === course.id && String(record.cycle || '') === currentCycle(course);
}
function courseDepartments(course) {
  return unique([...(course?.departments || []), course?.department]);
}
function selectedCourseDepartments() {
  return qsa('#courseDepartment option').filter(o => o.selected).map(o => o.value);
}
function userDepartmentSet(user=state.profile) {
  return unique([...(user?.managedDepartments || []), ...(user?.departments || []), user?.primaryDepartment]);
}
function intersects(a, b) {
  return a.some(x => b.includes(x));
}
function canManageCourse(course) {
  if (!state.profile || !course) return false;
  if (isAdminRole()) return true;
  if (isCourseManagerRole()) return course.managerUid === state.user?.uid || course.createdBy === state.user?.email;
  return course.managerUid === state.user?.uid || courseDepartments(course).some(canManageDepartment);
}

function isCourseOriginalPublisher(course) {
  if (!state.user || !course) return false;
  const ids = [
    course.publisherUid,
    course.postedByUid,
    course.managerUid,
    course.createdByUid
  ].filter(Boolean);
  const emails = [
    course.publisherEmail,
    course.postedByEmail,
    course.managerEmail,
    course.createdByEmail,
    course.createdBy
  ].filter(Boolean).map(v => String(v).toLowerCase());
  return ids.includes(state.user.uid) || emails.includes(String(state.user.email || '').toLowerCase());
}
function canEditCourse(course) {
  if (!state.profile || !course) return false;
  if (isSuperAdmin()) return true;
  return isCourseOriginalPublisher(course);
}
function isRequestOnlyCourse(course) {
  return false;
}
function isCourseMember(course) {
  return intersects(courseDepartments(course), userDepartmentSet()) || (course.memberIds || []).includes(state.user?.uid) || canManageCourse(course);
}

function showLogin() {
  $('loginScreen').classList.remove('hidden');
  $('app').classList.add('hidden');
  hideLoader();
}
function showApp() {
  $('loginScreen').classList.add('hidden');
  $('app').classList.remove('hidden');
}

async function logClient(where, message, details={}) {
  try {
    if (!state.user) return;
    await addDoc(collection(db, 'clientLogs'), {
      userId: state.user.uid,
      email: state.user.email,
      where,
      message,
      details,
      createdAt: serverTimestamp()
    });
  } catch (e) {}
}
async function audit(action, entity, entityId, details={}) {
  try {
    if (!state.user) return;
    await addDoc(collection(db, 'auditLogs'), {
      userId: state.user.uid,
      email: state.user.email,
      action,
      entity,
      entityId,
      details,
      createdAt: serverTimestamp()
    });
  } catch (e) {}
}

async function loginWithGoogle() {
  $('loginError').classList.add('hidden');
  showLoader(10, 'Opening Google sign-in...');
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    if (e.code === 'auth/popup-blocked' || e.code === 'auth/popup-closed-by-user') {
      try { await signInWithRedirect(auth, provider); return; } catch (ex) { e = ex; }
    }
    $('loginError').textContent = e.message || String(e);
    $('loginError').classList.remove('hidden');
    hideLoader();
  }
}
async function handleAuthUser(user) {
  try {
    if (!user) { showLogin(); return; }
    state.user = user;
    showLoader(20, 'Loading your profile...');
    state.profile = await getOrCreateProfile(user);
    showLoader(45, 'Loading courses...');
    await loadCourses();
    showLoader(65, 'Loading attendance...');
    await loadAttendance();
    await loadCourses();
    showLoader(75, 'Loading course membership...');
    await loadManagerData();
    showLoader(82, 'Preparing interface...');
    hydrateUserBox();
    fillSelects();
    renderAll();
    showApp();
    showPage(state.profile.profileCompleted ? 'dashboard' : 'profile');
    if (!state.profile.profileCompleted) toast('Please complete your profile and electronic signature.', 'warn');
    showLoader(100, 'Ready');
    hideLoader();
    await audit('LOGIN', 'User', user.uid);
  } catch (e) {
    hideLoader();
    toast(`Firebase permission error: ${e.message || e}`, 'error');
    await logClient('handleAuthUser', e.message || String(e));
    showApp();
  }
}
async function getOrCreateProfile(user) {
  const ref = doc(db, 'users', user.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) return { id: snap.id, ...snap.data() };
  const payload = {
    email: user.email,
    displayName: user.displayName || '',
    name: user.displayName || '',
    jobId: '',
    jobTitle: '',
    profession: '',
    mobile: '',
    role: 'User',
    status: 'Active',
    departments: [],
    primaryDepartment: '',
    signatureDataUrl: '',
    profileCompleted: false,
    createdAt: serverTimestamp(),
    firstLoginAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
  await setDoc(ref, payload);
  return { id: user.uid, ...payload, createdAt: new Date(), firstLoginAt: new Date(), updatedAt: new Date() };
}

async function loadCourses() {
  const snap = await getDocs(query(collection(db, 'courses'), where('status', '==', 'Active'), orderBy('createdAt', 'desc')));
  let raw = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  if (isCourseManagerRole()) {
    const ownSnap = await getDocs(query(collection(db, 'courses'), where('managerUid', '==', state.user.uid)));
    const merged = new Map(raw.map(c => [c.id, c]));
    ownSnap.docs.forEach(d => merged.set(d.id, { id: d.id, ...d.data() }));
    const legacySnap = await getDocs(query(collection(db, 'courses'), where('createdBy', '==', state.user.email)));
    legacySnap.docs.forEach(d => merged.set(d.id, { id: d.id, ...d.data() }));
    raw = Array.from(merged.values());
  }
  const userDeps = userDepartmentSet();
  state.courseNameIndex = raw.map(course => ({
    id: course.id,
    courseName: course.courseName || '',
    courseKey: course.courseKey || normalizeCourseName(course.courseName)
  }));
  state.courses = raw
    .filter(c => isAdminRole() || c.managerUid === state.user.uid || (c.memberIds || []).includes(state.user.uid) || c.department === 'All' || intersects(courseDepartments(c), userDeps))
    .map(course => {
      const cycle = currentCycle(course);
      const attendanceId = `${state.user.uid}_${course.id}_${cycle}`;
      const completedRec = courseCompletionRecordForUser({ ...course, cycleKey: cycle });
      const availableFrom = toDate(course.createdAt) || new Date();
      const firstLogin = toDate(state.profile.firstLoginAt) || new Date();
      const effectiveStart = availableFrom > firstLogin ? availableFrom : firstLogin;
      const daysAvailable = Math.floor((new Date() - effectiveStart) / 86400000);
      const opened = course.lastOpenedAt || false;
      return { ...course, cycleKey: cycle, completed: !!completedRec, completedRecord: completedRec || null, isDue: course.status === 'Active' && isCourseMember(course) && !completedRec && !opened && daysAvailable > 7, dueDays: daysAvailable };
    });
  await hydrateCoursePublisherUsers(state.courses);
  await syncPublisherSignatureToOwnedCourses();
}
async function loadAttendance() {
  const rows = [];
  if (!state.user) return;
  if (isAdminRole()) {
    const snap = await getDocs(query(collection(db, 'attendance'), orderBy('completedAt', 'desc')));
    snap.forEach(d => rows.push({ id: d.id, ...d.data() }));
  } else if (isManager()) {
    const allowed = permittedDepartments().filter(Boolean);
    for (let i = 0; i < allowed.length; i += 10) {
      const deps = allowed.slice(i, i + 10);
      if (!deps.length) continue;
      const snap = await getDocs(query(collection(db, 'attendance'), where('department', 'in', deps), orderBy('completedAt', 'desc')));
      snap.forEach(d => rows.push({ id: d.id, ...d.data() }));
    }
  } else {
    const snap = await getDocs(query(collection(db, 'attendance'), where('userId', '==', state.user.uid), orderBy('completedAt', 'desc')));
    snap.forEach(d => rows.push({ id: d.id, ...d.data() }));
  }
  const allowed = permittedDepartments();
  const managedCourseIds = state.courses.filter(canManageCourse).map(c => c.id);
  state.attendance = isManager() ? rows.filter(r => isAdminRole() || allowed.includes(r.department) || managedCourseIds.includes(r.courseId)) : rows;
}
async function loadManagerData() {
  state.users = [];
  state.courseRequests = [];
  if (!isManager()) return;
  try {
    const usersSnap = await getDocs(query(collection(db, 'users'), orderBy('name')));
    state.users = usersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    await logClient('loadManagerData.users', e.message || String(e));
  }
  try {
    const requestsSnap = await getDocs(query(collection(db, 'courseRequests'), orderBy('createdAt', 'desc')));
    state.courseRequests = requestsSnap.docs.map(d => ({ id: d.id, ...d.data() }))
      .filter(r => {
        const course = state.courses.find(c => c.id === r.courseId);
        return course && canManageCourse(course);
      });
  } catch (e) {
    await logClient('loadManagerData.courseRequests', e.message || String(e));
  }
}

function hydrateUserBox() {
  $('miniName').textContent = state.profile.name || state.user.displayName || 'User';
  $('miniEmail').textContent = state.user.email;

  const displayDepartments = accessDepartments().length ? accessDepartments() : [state.profile.primaryDepartment].filter(Boolean);
  const roleKey = canonicalRole(roleOf());
  const roleLabel = roleLabels[roleKey] || roleLabels[roleOf()] || roleOf();

  const miniRole = $('miniRole');
  miniRole.textContent = roleLabel;
  miniRole.className = `role-pill ${roleKey === 'SuperAdmin' ? 'role-super' : roleKey === 'CourseManager' ? 'role-manager' : 'role-user'}`;

  const deptWrap = $('miniDeptSummaryWrap');
  const deptPreview = $('miniDeptPreview');
  const deptTip = $('miniDeptTooltip');
  if (deptWrap && deptTip) {
    deptWrap.classList.toggle('hidden', !displayDepartments.length);
    if (deptPreview) deptPreview.textContent = `${displayDepartments.length} department${displayDepartments.length === 1 ? '' : 's'}`;
    deptTip.innerHTML = displayDepartments.map(d => `<div>- ${escapeHtml(d)}</div>`).join('');
  }

  $('adminNav').classList.toggle('hidden', !canManageCourses());
  if ($('analyticsNav')) $('analyticsNav').classList.toggle('hidden', !isManager());
  $('profileAlert').classList.toggle('hidden', !!state.profile.profileCompleted);
  syncAttendanceToolbar();
}
function fillSelects() {
  const depOptions = ['<option value="">Select department</option>'].concat(DEFAULT_DEPARTMENTS.map(d => `<option>${escapeHtml(d)}</option>`)).join('');
  $('profileDepartment').innerHTML = depOptions;
  const courseDeps = permittedDepartments();
  $('courseDepartment').innerHTML = courseDeps.map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('') || depOptions;
  if ($('attendanceDepartment')) $('attendanceDepartment').innerHTML = '<option value="">All permitted departments</option>' + permittedDepartments().map(d => `<option>${escapeHtml(d)}</option>`).join('');
  $('profileProfession').innerHTML = '<option value="">Select profession</option>' + DEFAULT_PROFESSIONS.map(p => `<option>${escapeHtml(p)}</option>`).join('');
  const professions = unique([...DEFAULT_PROFESSIONS, ...state.attendance.map(r => r.profession), state.profile?.profession]).sort();
  if ($('attendanceProfession')) $('attendanceProfession').innerHTML = '<option value="">All professions</option>' + professions.map(p => `<option>${escapeHtml(p)}</option>`).join('');
  $('attendanceCourse').innerHTML = '<option value="">All courses</option>' + state.courses.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.courseName)}</option>`).join('');
  if ($('courseDate') && !$('courseDate').value) $('courseDate').value = dateOnly(new Date());
}

function departmentSymbol(department='') {
  const d = String(department).toLowerCase();
  if (d.includes('emergency') && d.includes('nursing')) return '🚑';
  if (d.includes('icu') && d.includes('nursing')) return '🏥';
  if (d.includes('ccu') && d.includes('nursing')) return '❤️';
  if (d.includes('emergency') && d.includes('physician')) return '🩺';
  if (d.includes('icu') && d.includes('physician')) return '👨‍⚕️';
  if (d.includes('ccu') && d.includes('physician')) return '💓';
  if (d.includes('ipc')) return '🦠';
  if (d.includes('quality')) return '✅';
  if (d.includes('radiology')) return '🩻';
  if (d.includes('medical records')) return '📋';
  if (d.includes('reception')) return '🛎️';
  if (d.includes('social')) return '🤝';
  if (d.includes('house')) return '🧹';
  if (d.includes('pharmacy')) return '💊';
  if (d.includes('it')) return '💻';
  if (d.includes('respiratory')) return '🫁';
  if (d.includes('supply')) return '📦';
  if (d.includes('safety') || d.includes('security')) return '🛡️';
  if (d.includes('physical')) return '♿';
  if (d.includes('operation')) return '⚙️';
  if (d.includes('laboratory')) return '🧪';
  return '📚';
}
function departmentCourseCount(department, courses=state.courses) {
  return courses.filter(course => course.status === 'Active' && courseDepartments(course).includes(department)).length;
}
function departmentGridList(courses=state.courses) {
  const profileDeps = userDepartmentSet();
  const visible = isAdminRole() || isManager() ? DEFAULT_DEPARTMENTS : DEFAULT_DEPARTMENTS.filter(dep => profileDeps.includes(dep));
  return visible.filter(dep => departmentCourseCount(dep, courses) > 0);
}
function buildDepartmentCoursesGrid(courses=state.courses) {
  const groups = {};
  courses
    .filter(course => course.status === 'Active')
    .forEach(course => {
      const group = courseLibraryDepartment(course);
      if (!groups[group]) groups[group] = [];
      if (!groups[group].some(existing => existing.id === course.id)) groups[group].push(course);
    });

  const visibleGroups = [
    ...DEFAULT_DEPARTMENTS.filter(dep => groups[dep]?.length),
    ...Object.keys(groups).filter(dep => !DEFAULT_DEPARTMENTS.includes(dep)).sort((a, b) => a.localeCompare(b))
  ];

  if (!visibleGroups.length) return '<div class="empty">No course groups with active courses yet.</div>';

  return visibleGroups.map((group, index) => {
    const count = groups[group].length;
    return `
      <article class="department-course-card library-group-home-card dept-tone-${(index % 6) + 1}">
        <div class="department-course-symbol library-group-symbol" aria-hidden="true">${departmentSymbol(group)}</div>
        <div class="department-course-footer library-group-footer">
          <h4>${escapeHtml(group)}</h4>
          <span>${count} ${count === 1 ? 'Course' : 'Courses'}</span>
        </div>
      </article>`;
  }).join('');
}



function dataUrlByteSize(dataUrl='') {
  const base64 = String(dataUrl || '').split(',')[1] || '';
  return Math.ceil(base64.length * 3 / 4);
}
function imageFileToCourseDataUrl(file, maxW=720, maxH=1080) {
  return new Promise((resolve, reject) => {
    if (!file) return resolve('');
    if (!String(file.type || '').startsWith('image/')) return reject(new Error('Feature image file must be an image.'));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Unable to read the selected feature image.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Unable to process the selected feature image.'));
      img.onload = () => {
        const ratio = Math.min(maxW / img.width, maxH / img.height, 1);
        const w = Math.max(1, Math.round(img.width * ratio));
        const h = Math.max(1, Math.round(img.height * ratio));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        let quality = .84;
        let dataUrl = canvas.toDataURL('image/jpeg', quality);
        while (dataUrlByteSize(dataUrl) > 820000 && quality > .46) {
          quality -= .08;
          dataUrl = canvas.toDataURL('image/jpeg', quality);
        }
        if (dataUrlByteSize(dataUrl) > 940000) {
          reject(new Error('Feature image is too large after compression. Please use a smaller image.'));
          return;
        }
        resolve(dataUrl);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function extractDriveFileId(url='') {
  const raw = String(url || '');
  return (raw.match(/\/d\/([a-zA-Z0-9_-]+)/) || raw.match(/[?&]id=([a-zA-Z0-9_-]+)/) || [])[1] || '';
}
function normalizedImageUrl(url='') {
  const raw = String(url || '').trim();
  if (!raw) return '';
  const driveId = extractDriveFileId(raw);
  if (driveId) return `https://drive.google.com/thumbnail?id=${encodeURIComponent(driveId)}&sz=w1600`;
  return raw;
}
function courseFeatureImageUrl(course) {
  return (
    course?.featureImageDataUrl ||
    course?.sliderImageDataUrl ||
    normalizedImageUrl(
      course?.featureImageUrl ||
      course?.sliderImageUrl ||
      course?.courseImageUrl ||
      course?.coverImageUrl ||
      course?.thumbnailUrl ||
      ''
    )
  );
}
function courseFeaturePublishedLabel(course) {
  const date = toDate(course?.createdAt || course?.courseDate || course?.postedDate || course?.availableFrom) || new Date();
  return date.toLocaleString('en-US', { month: 'short', year: 'numeric' });
}
function courseCompletedCount(course) {
  const records = state.attendance.filter(row => row.courseId === course?.id);
  if (records.length) return unique(records.map(row => row.userId || row.email || row.userEmail || row.id)).length;
  return course?.completedCount || course?.attendanceCount || (course?.completed ? 1 : 0);
}
function svgSliderImage(title, c1='#1d4ed8', c2='#18b8c8') {
  const safe = String(title || 'CareLearn Pro').replace(/[<>&]/g, '');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1400 760"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient><radialGradient id="r" cx=".78" cy=".25" r=".65"><stop stop-color="#ffffff" stop-opacity=".22"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient></defs><rect width="1400" height="760" fill="url(#g)"/><rect width="1400" height="760" fill="url(#r)"/><circle cx="1120" cy="180" r="180" fill="#fff" opacity=".12"/><circle cx="190" cy="620" r="220" fill="#0f172a" opacity=".18"/><path d="M70 615 C260 500 390 555 560 420 S900 210 1320 300" fill="none" stroke="#fff" stroke-width="7" opacity=".18"/><text x="88" y="156" fill="#fff" font-family="Arial, sans-serif" font-size="56" font-weight="800">${safe}</text><text x="90" y="218" fill="#dbeafe" font-family="Arial, sans-serif" font-size="28" font-weight="700">CareLearn Pro Featured Course</text></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}
function demoFeatureSlides() {
  return [
    { id:'demo-feature-1', demo:true, courseName:'Infection Control Essentials', requiredMinutes:20, createdAt:new Date(), image:svgSliderImage('Infection Control Essentials', '#1e3a8a', '#18b8c8'), completedCount:18 },
    { id:'demo-feature-2', demo:true, courseName:'Patient Safety Training', requiredMinutes:15, createdAt:new Date(), image:svgSliderImage('Patient Safety Training', '#172554', '#4f46e5'), completedCount:24 },
    { id:'demo-feature-3', demo:true, courseName:'Emergency Response Skills', requiredMinutes:30, createdAt:new Date(), image:svgSliderImage('Emergency Response Skills', '#0f172a', '#2563eb'), completedCount:12 }
  ];
}
function featureSliderSlides(courses=state.courses) {
  const real = courses
    .filter(course => course.status === 'Active' && courseFeatureImageUrl(course))
    .map(course => ({ ...course, image: courseFeatureImageUrl(course), demo:false }));
  return real.length ? real : demoFeatureSlides();
}
function buildFeatureSliderHtml(courses=state.courses) {
  const slides = featureSliderSlides(courses);
  if (!slides.length) return '';
  return `
    <div class="feature-slider-shell cinematic-course-slider" data-count="${slides.length}">
      <button type="button" class="feature-slider-nav prev" data-feature-step="-1" aria-label="Previous featured course">‹</button>
      <div class="feature-slider-viewport">
        <div class="feature-slider-stage">
          ${slides.map((course, index) => `
            <article class="feature-slide ${index === 0 ? 'is-active' : ''}" data-id="${escapeHtml(course.id)}" data-demo="${course.demo ? '1' : '0'}" style="--offset:${index};">
              <img src="${escapeHtml(course.image)}" alt="${escapeHtml(course.courseName)}" loading="lazy">
              <div class="feature-slide-top">
                <span>${courseCompletedCount(course)} completed</span>
              </div>
              <div class="feature-slide-play" aria-hidden="true">▶</div>
              <div class="feature-slide-overlay">
                <h3>${escapeHtml(course.courseName)}</h3>
                <div class="feature-slide-meta">
                  <span>${escapeHtml(courseFeaturePublishedLabel(course))}</span>
                  <span>${Number(course.requiredMinutes || 0)} min</span>
                </div>
              </div>
            </article>`).join('')}
        </div>
      </div>
      <button type="button" class="feature-slider-nav next" data-feature-step="1" aria-label="Next featured course">›</button>
      <div class="feature-slider-dots">${slides.map((_, index) => `<button type="button" class="${index === 0 ? 'active' : ''}" data-feature-index="${index}" aria-label="Go to slide ${index + 1}"></button>`).join('')}</div>
    </div>`;
}
function setFeatureSliderIndex(index) {
  const shell = document.querySelector('.feature-slider-shell');
  if (!shell) return;
  const slides = qsa('.feature-slide');
  const count = slides.length;
  if (!count) return;
  const next = ((index % count) + count) % count;
  state.featureSliderIndex = next;
  slides.forEach((slide, i) => {
    let offset = i - next;
    if (offset > count / 2) offset -= count;
    if (offset < -count / 2) offset += count;
    const abs = Math.abs(offset);
    slide.style.setProperty('--offset', offset);
    slide.classList.toggle('is-active', offset === 0);
    slide.classList.toggle('is-near', abs === 1);
    slide.classList.toggle('is-far', abs === 2);
    slide.classList.toggle('is-hidden-slide', abs > 2);
    slide.setAttribute('aria-hidden', abs > 2 ? 'true' : 'false');
  });
  qsa('.feature-slider-dots button').forEach((dot, i) => dot.classList.toggle('active', i === next));
}
function startFeatureSliderAuto() {
  if (state.featureSliderTimer) clearInterval(state.featureSliderTimer);
  const shell = document.querySelector('.feature-slider-shell');
  if (!shell || Number(shell.dataset.count || 0) < 2) return;
  state.featureSliderTimer = setInterval(() => setFeatureSliderIndex(Number(state.featureSliderIndex || 0) + 1), 4500);
}
function bindFeatureSlider() {
  const shell = document.querySelector('.feature-slider-shell');
  if (!shell) return;
  if (shell.dataset.bound !== '1') {
    shell.dataset.bound = '1';
    qsa('[data-feature-step]').forEach(btn => btn.addEventListener('click', () => {
      setFeatureSliderIndex(Number(state.featureSliderIndex || 0) + Number(btn.dataset.featureStep || 0));
      startFeatureSliderAuto();
    }));
    qsa('[data-feature-index]').forEach(btn => btn.addEventListener('click', () => {
      setFeatureSliderIndex(Number(btn.dataset.featureIndex || 0));
      startFeatureSliderAuto();
    }));
    qsa('.feature-slide').forEach(slide => slide.addEventListener('click', () => {
      if (slide.dataset.demo === '1') return;
      const course = state.courses.find(c => c.id === slide.dataset.id);
      if (!course) return;
      if (isCourseMember(course)) return openCourse(course.id);
      return requestCourseAccess(course.id);
    }));
    shell.addEventListener('mouseenter', () => { if (state.featureSliderTimer) clearInterval(state.featureSliderTimer); });
    shell.addEventListener('mouseleave', startFeatureSliderAuto);
  }
  const count = Number(shell.dataset.count || 0);
  if (Number(state.featureSliderIndex || 0) >= count) state.featureSliderIndex = 0;
  setFeatureSliderIndex(Number(state.featureSliderIndex || 0));
  startFeatureSliderAuto();
}

function renderAll() { renderDashboard(); renderCourses(); renderAnalytics(); renderAttendance(); fillProfileForm(); renderCourseManagement(); renderRoleAdmin(); }
function renderDashboard() {
  const trackedCourses = state.courses.filter(c => c.status === 'Active' && isCourseMember(c));
  const assigned = trackedCourses.length;
  const completed = trackedCourses.filter(c => c.completed).length;
  const due = trackedCourses.filter(c => c.isDue).length;
  const pending = Math.max(0, assigned - completed);
  const coverage = assigned ? `${Math.round(completed / assigned * 100)}%` : '0%';

  $('statAssigned').textContent = assigned;
  $('statCompleted').textContent = completed;
  $('statPending').textContent = pending;
  $('statDue').textContent = due;
  $('statCoverage').textContent = coverage;

  if ($('positionName')) $('positionName').textContent = state.profile?.profession || 'Employee';
  if ($('departmentPostedCourses')) $('departmentPostedCourses').textContent = trackedCourses.length;
  if ($('attendanceAccomplished')) $('attendanceAccomplished').textContent = completed;
  if ($('dashboardPlanner')) $('dashboardPlanner').innerHTML = buildPlannerHtml(trackedCourses);
  if ($('featureSliderBox')) $('featureSliderBox').innerHTML = buildFeatureSliderHtml(state.courses);

  $('dashboardCourses').innerHTML = buildCoursesBreakdownHtml(state.courses.slice(0, 10), true);
  const dueCourses = state.courses.filter(c => c.isDue);
  $('dueCoursesBox').innerHTML = dueCourses.length ? dueCourses.map(c => `<div class="alert warn"><strong>${escapeHtml(c.courseName)}</strong><br>${escapeHtml(courseDepartments(c).join(', '))} · ${courseDateLabel(c)} · ${c.dueDays} days</div>`).join('') : '<div class="empty">No due courses.</div>';
  renderManagerDashboard();
  bindPlannerMonthNav();
  bindFeatureSlider();
  bindOpenButtons();
}


function userTrainingAttendanceRows() {
  return state.attendance.filter(row =>
    row.userId === state.user?.uid ||
    row.email === state.user?.email ||
    row.userEmail === state.user?.email ||
    (!row.userId && !row.email && !row.userEmail && !isManager())
  );
}
function monthTrainingMinutes(year, monthIndex) {
  return userTrainingAttendanceRows().reduce((total, row) => {
    const completedAt = toDate(row.completedAt);
    if (!completedAt) return total;
    if (completedAt.getFullYear() !== year || completedAt.getMonth() !== monthIndex) return total;
    return total + Number(row.durationMinutes || row.duration || 0);
  }, 0);
}
function allTrainingMinutes() {
  return userTrainingAttendanceRows().reduce((total, row) => total + Number(row.durationMinutes || row.duration || 0), 0);
}
function formatTrainingHours(minutes) {
  const total = Math.max(0, Math.round(Number(minutes || 0)));
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  return `${hours}h ${mins}m`;
}
function buildTrainingHoursCard(year, monthIndex) {
  const currentMinutes = monthTrainingMinutes(year, monthIndex);
  const previousDate = new Date(year, monthIndex - 1, 1);
  const previousMinutes = monthTrainingMinutes(previousDate.getFullYear(), previousDate.getMonth());
  const overallMinutes = allTrainingMinutes();
  const currentHours = formatTrainingHours(currentMinutes);
  const previousHours = formatTrainingHours(previousMinutes);
  const overallHours = formatTrainingHours(overallMinutes);
  const currentMonthLabel = new Date(year, monthIndex, 1).toLocaleString('en-US', { month: 'short', year: 'numeric' });
  const previousMonthLabel = previousDate.toLocaleString('en-US', { month: 'short', year: 'numeric' });
  const currentVsPrevious = previousMinutes ? Math.round(((currentMinutes - previousMinutes) / previousMinutes) * 100) : (currentMinutes ? 100 : 0);
  const trendLabel = currentVsPrevious > 0 ? `+${currentVsPrevious}%` : `${currentVsPrevious}%`;
  const points = [
    Math.max(1, previousMinutes * .55),
    Math.max(1, previousMinutes || currentMinutes * .35),
    Math.max(1, (previousMinutes + currentMinutes) / 2 || 1),
    Math.max(1, currentMinutes || 1),
    Math.max(1, currentMinutes * .62 || previousMinutes * .85 || 1),
    Math.max(1, overallMinutes ? Math.max(currentMinutes, previousMinutes) * .72 : 1)
  ];
  const max = Math.max(...points, 1);
  const coords = points.map((value, index) => {
    const x = 20 + index * 54;
    const y = 112 - ((value / max) * 76);
    return `${x},${y}`;
  }).join(' ');
  return `
    <section class="training-hours-card" aria-label="Training hours summary">
      <div class="training-hours-glow"></div>
      <div class="training-hours-top">
        <span>Training hours summary</span>
        <small>${escapeHtml(currentMonthLabel)}</small>
      </div>
      <svg class="training-hours-chart" viewBox="0 0 310 130" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="trainingLineGradient" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stop-color="#38bdf8"/>
            <stop offset="55%" stop-color="#60a5fa"/>
            <stop offset="100%" stop-color="#a78bfa"/>
          </linearGradient>
        </defs>
        <path class="training-grid-line" d="M18 100 H292 M18 72 H292 M18 44 H292" />
        <polyline class="training-line" points="${coords}" />
        <circle class="training-dot" cx="${20 + 3 * 54}" cy="${112 - ((points[3] / max) * 76)}" r="7" />
      </svg>
      <div class="training-hours-main">
        <span>This month</span>
        <strong>${currentHours}</strong>
        <em>${escapeHtml(trendLabel)} vs last month</em>
      </div>
      <div class="training-hours-stats">
        <div><span>${escapeHtml(previousMonthLabel)}</span><strong>${previousHours}</strong></div>
        <div><span>Overall</span><strong>${overallHours}</strong></div>
      </div>
    </section>`;
}


function plannerBaseDate(course) {
  const value = courseDateValue(course);
  const parts = String(value || '').split('-').map(Number);
  if (parts.length === 3 && parts.every(Boolean)) return new Date(parts[0], parts[1] - 1, parts[2]);
  const fallback = toDate(course?.courseDate || course?.postedDate || course?.availableFrom || course?.createdAt) || new Date();
  return new Date(fallback.getFullYear(), fallback.getMonth(), fallback.getDate());
}
function plannerOccurrenceCycle(course, date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const q = Math.floor(date.getMonth() / 3) + 1;
  const cycle = String(course?.cycle || 'One Time').toLowerCase();
  if (cycle === 'monthly') return `${y}-${m}`;
  if (cycle === 'quarterly') return `${y}-Q${q}`;
  if (cycle === 'semi annual') return `${y}-H${date.getMonth() < 6 ? 1 : 2}`;
  if (cycle === 'annual' || cycle === 'yearly') return `${y}`;
  return 'ONE-TIME';
}
function plannerCompletedRecord(course, occurrenceCycle) {
  return state.attendance.find(row =>
    row.courseId === course.id &&
    isOwnAttendanceRecord(row) &&
    (
      String(row.cycle || '') === occurrenceCycle ||
      (occurrenceCycle === 'ONE-TIME' && (!row.cycle || row.cycle === 'ONE-TIME'))
    )
  ) || null;
}
function plannerOccurrenceDateForMonth(course, year, month) {
  const base = plannerBaseDate(course);
  const baseYear = base.getFullYear();
  const baseMonth = base.getMonth();
  const baseDay = base.getDate();
  const monthDiff = (year - baseYear) * 12 + (month - baseMonth);
  const cycle = String(course?.cycle || 'One Time').toLowerCase();
  const day = Math.min(baseDay, new Date(year, month + 1, 0).getDate());

  if (cycle === 'monthly') {
    if (monthDiff < 0) return null;
    return new Date(year, month, day);
  }
  if (cycle === 'annual' || cycle === 'yearly') {
    if (year < baseYear || month !== baseMonth) return null;
    return new Date(year, month, day);
  }
  if (cycle === 'quarterly') {
    if (monthDiff < 0 || monthDiff % 3 !== 0) return null;
    return new Date(year, month, day);
  }
  if (cycle === 'semi annual') {
    if (monthDiff < 0 || monthDiff % 6 !== 0) return null;
    return new Date(year, month, day);
  }

  return (year === baseYear && month === baseMonth) ? new Date(year, month, day) : null;
}
function plannerCourseForOccurrence(course, date) {
  const cycle = plannerOccurrenceCycle(course, date);
  const completedRecord = plannerCompletedRecord(course, cycle);
  const isCompletedForCurrentUser = !!completedRecord;
  return {
    ...course,
    cycleKey: cycle,
    completed: isCompletedForCurrentUser,
    completedRecord: completedRecord || null,
    isDue: !completedRecord && !!course.isDue
  };
}

function buildPlannerHtml(courses) {
  const assigned = courses
    .slice()
    .sort((a, b) => String(courseDateValue(a)).localeCompare(String(courseDateValue(b))));

  if (!assigned.length) return '<div class="empty">No assigned courses in your current planner.</div>';

  const pad = (n) => String(n).padStart(2, '0');
  const keyOf = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

  const today = new Date();
  const monthOffset = Number(state.plannerMonthOffset || 0);
  const baseDate = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1);

  const year = baseDate.getFullYear();
  const month = baseDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const monthName = firstDay.toLocaleString('en-US', { month: 'long', year: 'numeric' });
  const startOffset = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  const eventsByDay = assigned.reduce((map, course) => {
    const occurrenceDate = plannerOccurrenceDateForMonth(course, year, month);
    if (!occurrenceDate) return map;
    const key = keyOf(occurrenceDate);
    if (!map[key]) map[key] = [];
    map[key].push(plannerCourseForOccurrence(course, occurrenceDate));
    return map;
  }, {});

  const weekdays = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const dayIndex = i - startOffset + 1;
    let cellDate;
    let isMuted = false;
    if (dayIndex < 1) {
      const d = daysInPrevMonth + dayIndex;
      cellDate = new Date(year, month - 1, d);
      isMuted = true;
    } else if (dayIndex > daysInMonth) {
      const d = dayIndex - daysInMonth;
      cellDate = new Date(year, month + 1, d);
      isMuted = true;
    } else {
      cellDate = new Date(year, month, dayIndex);
    }

    const key = keyOf(cellDate);
    const events = eventsByDay[key] || [];
    const isToday = key === keyOf(today);
    const hasCompleted = events.some(course => course.completed);
    const hasPending = events.some(course => !course.completed && isCourseMember(course));
    cells.push(`
      <div class="calendar-day ${isMuted ? 'is-muted' : ''} ${isToday ? 'is-today' : ''}">
        <div class="calendar-day-top">
          <span class="calendar-day-number">${cellDate.getDate()}</span>
          <span class="calendar-day-symbols">
            ${hasCompleted ? '<span class="calendar-completed-check" title="Completed">✓</span>' : ''}
            ${hasPending ? '<span class="calendar-pending-check" title="Pending">!</span>' : ''}
          </span>
        </div>
        <div class="calendar-events">
          ${events.slice(0, 3).map(course => `
            <button type="button" class="calendar-event ${courseStatusClass(course)} open-course" data-id="${escapeHtml(course.id)}">
              <span>${escapeHtml(course.courseName)}</span>
              <small>${Number(course.requiredMinutes || 0)} min · ${escapeHtml(courseStatusLabel(course))}</small>
            </button>`).join('')}
          ${events.length > 3 ? `<small class="calendar-more">+${events.length - 3} more</small>` : ''}
        </div>
      </div>`);
  }

  return `
    <div class="planner-calendar">
      <div class="planner-calendar-head">
        <div>
          <h4>${escapeHtml(monthName)}</h4>
          <span>${assigned.length} assigned course${assigned.length === 1 ? '' : 's'} in your planner</span>
        </div>
        <div class="calendar-nav-fake">
          <button type="button" class="calendar-month-nav" data-month-step="-1" aria-label="Previous month">‹</button>
          <button type="button" class="calendar-month-nav" data-month-step="1" aria-label="Next month">›</button>
        </div>
      </div>
      <div class="calendar-weekdays">${weekdays.map(day => `<div>${day}</div>`).join('')}</div>
      <div class="calendar-grid">${cells.join('')}</div>
    </div>
    ${buildTrainingHoursCard(year, month)}`;
}

function bindPlannerMonthNav() {
  qsa('.calendar-month-nav').forEach(btn => {
    if (btn.dataset.bound === '1') return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      state.plannerMonthOffset = Number(state.plannerMonthOffset || 0) + Number(btn.dataset.monthStep || 0);
      const trackedCourses = state.courses.filter(c => c.status === 'Active' && isCourseMember(c));
      if ($('dashboardPlanner')) $('dashboardPlanner').innerHTML = buildPlannerHtml(trackedCourses);
      bindPlannerMonthNav();
      bindOpenButtons();
    });
  });
}
function renderManagerDashboard() {
  const box = $('managerDashboardBox');
  if (!box) return;
  const managed = state.courses.filter(canManageCourse);
  box.classList.toggle('hidden', !managed.length || !isManager());
  if (!managed.length || !isManager()) return;
  $('managerCoverageBody').innerHTML = managed.map(course => {
    const members = unique(courseDepartments(course).flatMap(dep => activeSystemUsersForDepartment(dep).map(user => user.id)));
    const doneIds = new Set(state.attendance.filter(a => attendanceMatchesCourseCycle(a, course)).map(a => a.userId));
    const completed = members.filter(id => doneIds.has(id)).length;
    const pct = members.length ? Math.round(completed / members.length * 100) : 0;
    const pendingNames = members
      .filter(id => !doneIds.has(id))
      .map(id => {
        const user = state.users.find(u => u.id === id) || {};
        return user.name || user.email || id;
      });
    return `<tr><td>${escapeHtml(course.courseName)}</td><td>${members.length}</td><td>${completed}</td><td>${members.length - completed}</td><td><strong>${pct}%</strong></td><td>${escapeHtml(pendingNames.join(', ') || 'None')}</td></tr>`;
  }).join('');
}
function renderCourses() {
  $('coursesBreakdown').innerHTML = buildCoursesBreakdownHtml(state.courses, false);
  bindOpenButtons();
}

function setupAttendanceAuditCourses(managedCourses=state.courses.filter(canManageCourse)) {
  const select = $('auditCourseSelect');
  if (!select) return;
  const current = select.value;
  const options = managedCourses
    .slice()
    .sort((a, b) => String(a.courseName || '').localeCompare(String(b.courseName || '')))
    .map(course => `<option value="${escapeHtml(course.id)}">${escapeHtml(course.courseName)} · ${escapeHtml(courseLibraryDepartment(course))}</option>`)
    .join('');
  select.innerHTML = `<option value="">Select course</option>${options}`;
  if (managedCourses.some(course => course.id === current)) select.value = current;
}
function attendanceAuditRowsForCourse(courseId) {
  return state.attendance
    .filter(row => row.courseId === courseId)
    .sort((a, b) => (toDate(b.completedAt)?.getTime() || 0) - (toDate(a.completedAt)?.getTime() || 0));
}
function renderAttendanceAuditPanel(rows=null) {
  const audit = state.attendanceAudit;
  const data = rows || audit.rows || [];
  if ($('auditStatusText')) $('auditStatusText').value = audit.running ? 'Running - checking every 10 seconds' : 'Stopped';
  if ($('auditTotalCount')) $('auditTotalCount').textContent = data.length;
  if ($('auditNewCount')) $('auditNewCount').textContent = Math.max(0, data.length - Number(audit.startCount || 0));
  if ($('auditChecksCount')) $('auditChecksCount').textContent = audit.checks || 0;
  if ($('auditLastUpdate')) $('auditLastUpdate').textContent = audit.lastActivityAt ? timeOnly(audit.lastActivityAt) : '--:--';
  if ($('auditLiveHint')) {
    $('auditLiveHint').textContent = audit.running
      ? 'Live audit is active. It will stop after 1 minute without new attendance.'
      : 'Live audit is stopped.';
    $('auditLiveHint').classList.toggle('running', !!audit.running);
  }
  const body = $('auditAttendanceBody');
  if (body) {
    body.innerHTML = data.length ? data.slice(0, 20).map(row => `
      <tr>
        <td>${escapeHtml(row.name || row.userName || row.email || row.userEmail || '')}</td>
        <td>${escapeHtml(row.jobId || '')}</td>
        <td>${escapeHtml(row.department || '')}</td>
        <td>${escapeHtml(dateOnly(row.completedAt))} ${escapeHtml(timeOnly(row.completedAt))}</td>
        <td>${escapeHtml(row.score ?? '')}</td>
        <td>${escapeHtml(row.durationMinutes || row.duration || 0)} min</td>
      </tr>`).join('') : '<tr><td colspan="6">No attendance found for this course yet.</td></tr>';
  }
}
async function fetchAttendanceAuditRows(courseId) {
  const snap = await getDocs(query(collection(db, 'attendance'), where('courseId', '==', courseId)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (toDate(b.completedAt)?.getTime() || 0) - (toDate(a.completedAt)?.getTime() || 0));
}
async function runAttendanceAuditCheck() {
  const audit = state.attendanceAudit;
  if (!audit.running || !audit.courseId) return;
  audit.checks = Number(audit.checks || 0) + 1;
  try {
    const rows = await fetchAttendanceAuditRows(audit.courseId);
    const previousCount = Number(audit.lastCount || 0);
    audit.rows = rows;
    audit.lastCount = rows.length;
    const now = new Date();
    if (rows.length > previousCount) {
      audit.lastActivityAt = now;
      toast(`${rows.length - previousCount} new attendance record(s) captured.`, 'success');
    }
    renderAttendanceAuditPanel(rows);
    const idleMs = now - (audit.lastActivityAt || audit.startedAt || now);
    if (idleMs >= 60000) {
      stopAttendanceAudit('No new attendance for 1 minute. Live audit stopped automatically.');
    }
  } catch (e) {
    stopAttendanceAudit(e.message || String(e));
    toast(`Attendance audit stopped: ${e.message || e}`, 'error');
  }
}
async function startAttendanceAudit() {
  const courseId = $('auditCourseSelect')?.value || '';
  if (!courseId) return toast('Please select a course first.', 'warn');
  const course = state.courses.find(c => c.id === courseId);
  if (!course || !canManageCourse(course)) return toast('You cannot audit this course.', 'error');
  stopAttendanceAudit('', false);
  const existingRows = await fetchAttendanceAuditRows(courseId).catch(() => attendanceAuditRowsForCourse(courseId));
  state.attendanceAudit = {
    timer: null,
    running: true,
    courseId,
    startCount: existingRows.length,
    lastCount: existingRows.length,
    lastActivityAt: new Date(),
    startedAt: new Date(),
    checks: 0,
    rows: existingRows
  };
  renderAttendanceAuditPanel(existingRows);
  await runAttendanceAuditCheck();
  state.attendanceAudit.timer = setInterval(runAttendanceAuditCheck, 10000);
  toast('Live attendance audit started.', 'success');
}
function stopAttendanceAudit(message='', showToast=true) {
  if (state.attendanceAudit?.timer) clearInterval(state.attendanceAudit.timer);
  state.attendanceAudit.timer = null;
  state.attendanceAudit.running = false;
  renderAttendanceAuditPanel(state.attendanceAudit.rows || []);
  if (message && showToast) toast(message, message.toLowerCase().includes('error') ? 'error' : 'warn');
}

function renderAnalytics() {
  const page = $('page-analytics');
  if (!page) return;
  page.classList.toggle('hidden', state.activePage !== 'analytics');
  const managed = state.courses.filter(canManageCourse);
  renderManagerDashboard();
  const deptBox = $('analyticsDepartmentCoverage');
  if (deptBox) {
    deptBox.innerHTML = managed.length ? buildManagerDepartmentCoverageHtml(managed) : '<div class="empty">No analytics data available.</div>';
  }
  setupMonthlyTrainingFilters(managed);
  renderMonthlyTrainingCoverage(managed);
  setupAttendanceAuditCourses(managed);
  renderAttendanceAuditPanel();
}
function selectedAnalyticsMonth() {
  const input = $('analyticsTrainingMonth');
  const now = new Date();
  const fallback = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  if (input && !input.value) input.value = fallback;
  return input?.value || fallback;
}
function setupMonthlyTrainingFilters(managedCourses) {
  const monthInput = $('analyticsTrainingMonth');
  const professionSelect = $('analyticsTrainingProfession');
  const departmentSelect = $('analyticsTrainingDepartment');
  if (!monthInput || !professionSelect || !departmentSelect) return;

  selectedAnalyticsMonth();

  const departments = unique(managedCourses.flatMap(courseDepartments)).filter(dep => permittedDepartments().includes(dep) || isAdminRole()).sort();
  const currentDepartment = departmentSelect.value;
  departmentSelect.innerHTML = '<option value="">All departments</option>' + departments.map(dep => `<option value="${escapeHtml(dep)}">${escapeHtml(dep)}</option>`).join('');
  if (departments.includes(currentDepartment)) departmentSelect.value = currentDepartment;

  const allowedDeps = departmentSelect.value ? [departmentSelect.value] : departments;
  const professions = unique(state.users
    .filter(user => (user.status || 'Active') !== 'Inactive')
    .filter(user => !allowedDeps.length || allowedDeps.some(dep => userRegisteredInDepartment(user, dep)))
    .map(user => user.profession)
    .concat(DEFAULT_PROFESSIONS)
  ).sort();

  const currentProfession = professionSelect.value;
  professionSelect.innerHTML = '<option value="">All professions</option>' + professions.map(prof => `<option value="${escapeHtml(prof)}">${escapeHtml(prof)}</option>`).join('');
  if (professions.includes(currentProfession)) professionSelect.value = currentProfession;

  [monthInput, professionSelect, departmentSelect].forEach(el => {
    if (!el || el.dataset.analyticsBound === '1') return;
    el.dataset.analyticsBound = '1';
    el.addEventListener('change', () => {
      setupMonthlyTrainingFilters(state.courses.filter(canManageCourse));
      renderMonthlyTrainingCoverage(state.courses.filter(canManageCourse));
    });
  });
}
function renderMonthlyTrainingCoverage(managedCourses) {
  const box = $('analyticsMonthlyTrainingBody');
  if (!box) return;

  const month = selectedAnalyticsMonth();
  const selectedProfession = $('analyticsTrainingProfession')?.value || '';
  const selectedDepartment = $('analyticsTrainingDepartment')?.value || '';

  const departments = unique(managedCourses.flatMap(courseDepartments)).filter(dep => permittedDepartments().includes(dep) || isAdminRole()).sort();
  const targetDepartments = selectedDepartment ? [selectedDepartment] : departments;

  const monthlyCourses = managedCourses.filter(course =>
    courseStatusLabel(course) !== 'Request Required' &&
    courseDateValue(course).startsWith(month) &&
    (!selectedDepartment || courseDepartments(course).includes(selectedDepartment))
  );

  const rows = targetDepartments.map(department => {
    const deptCourses = monthlyCourses.filter(course => courseDepartments(course).includes(department));
    const users = activeSystemUsersForDepartment(department)
      .filter(user => !selectedProfession || user.profession === selectedProfession);

    const obligations = new Map();
    deptCourses.forEach(course => {
      users.forEach(user => {
        obligations.set(`${course.id}_${user.id}`, { course, user });
      });
    });

    const completed = Array.from(obligations.values()).filter(({ course, user }) =>
      state.attendance.some(record =>
        record.userId === user.id &&
        record.courseId === course.id &&
        dateOnly(toDate(record.completedAt)).startsWith(month)
      )
    ).length;

    const total = obligations.size;
    const pct = total ? Math.round(completed / total * 100) : 0;
    return {
      department,
      courses: deptCourses.length,
      assigned: total,
      completed,
      pending: Math.max(0, total - completed),
      pct
    };
  }).filter(row => selectedDepartment || row.courses || row.assigned);

  const totals = rows.reduce((acc, row) => {
    acc.courses += row.courses;
    acc.assigned += row.assigned;
    acc.completed += row.completed;
    acc.pending += row.pending;
    return acc;
  }, { courses: 0, assigned: 0, completed: 0, pending: 0 });
  const overallPct = totals.assigned ? Math.round(totals.completed / totals.assigned * 100) : 0;

  box.innerHTML = `
    <p class="coverage-soft-note">Monthly coverage is calculated from courses published in the selected month for your managed departments.</p>
    <div class="monthly-coverage-summary">
      <div class="monthly-coverage-kpi"><span>Coverage</span><strong>${overallPct}%</strong></div>
      <div class="monthly-coverage-kpi"><span>Published Courses</span><strong>${totals.courses}</strong></div>
      <div class="monthly-coverage-kpi"><span>Completed</span><strong>${totals.completed}</strong></div>
      <div class="monthly-coverage-kpi"><span>Pending</span><strong>${totals.pending}</strong></div>
    </div>
    <div class="table-wrap monthly-coverage-table">
      <table>
        <thead><tr><th>Department</th><th>Published Courses</th><th>Assigned</th><th>Completed</th><th>Pending</th><th>Coverage</th></tr></thead>
        <tbody>${rows.length ? rows.map(row => `
          <tr>
            <td>${escapeHtml(row.department)}</td>
            <td>${row.courses}</td>
            <td>${row.assigned}</td>
            <td>${row.completed}</td>
            <td>${row.pending}</td>
            <td><strong>${row.pct}%</strong></td>
          </tr>`).join('') : '<tr><td colspan="6">No published training coverage data for the selected filters.</td></tr>'}</tbody>
      </table>
    </div>`;
}
function buildManagerDepartmentCoverageHtml(managedCourses) {
  if (!managedCourses.length) return '';
  const cards = managedCourses.map(course => {
    const rows = courseDepartments(course).map(department => {
      const users = activeSystemUsersForDepartment(department);
      const doneIds = new Set(state.attendance
        .filter(a => attendanceMatchesCourseCycle(a, course) && a.department === department)
        .map(a => a.userId));
      const completed = users.filter(user => doneIds.has(user.id)).length;
      const total = users.length;
      const pct = total ? Math.round((completed / total) * 100) : 0;
      return `
        <div class="coverage-row">
          <div>
            <strong>${escapeHtml(department)}</strong>
            <span>${total} registered · ${completed} completed · ${Math.max(0, total - completed)} pending</span>
          </div>
          <div class="coverage-meter" aria-label="${pct}% coverage">
            <span style="width:${pct}%"></span>
          </div>
          <b>${pct}%</b>
        </div>`;
    }).join('');
    return `
      <article class="coverage-card">
        <header>
          <div>
            <h4>${escapeHtml(course.courseName)}</h4>
            <p>${escapeHtml(courseDepartments(course).join(', '))}</p>
          </div>
          <span class="coverage-cycle">${escapeHtml(currentCycle(course))}</span>
        </header>
        ${rows || '<div class="empty">No departments assigned.</div>'}
      </article>`;
  }).join('');
  return `
    <div class="manager-coverage-panel">
      <div class="section-title">
        <div>
          <h3>Department Coverage</h3>
          <p>Current cycle coverage is calculated from registered users in each department.</p>
        </div>
      </div>
      <div class="coverage-grid">${cards}</div>
    </div>`;
}
function buildCoursesBreakdownHtml(courses, compact) {
  if (!courses.length) return '<div class="empty">No courses available yet.</div>';

  const courseCardHtml = (c, index) => `
      <article class="course-box-card course-box-card-v2 course-card-clickable color-${(index % 5) + 1}" data-id="${escapeHtml(c.id)}" data-action="${isCourseMember(c) ? 'open' : 'request'}" tabindex="0" role="button" aria-label="${escapeHtml(c.courseName)}">
        <div class="course-title-zone">
          <h4>${escapeHtml(c.courseName)}</h4>
<div class="course-prepared-line">
  Prepared by: <strong>${escapeHtml(coursePublisherName(c))}</strong>
  <br>
  ${escapeHtml(coursePublisherDepartment(c))}
</div>          <div class="department-card-tooltip">${departmentTooltip(courseDepartments(c))}</div>
        </div>

        <table class="course-card-info-table" aria-label="Course details">
          <thead>
            <tr>
              <th>Course Date</th>
              <th>Status</th>
              <th>Time</th>
              <th>Repetition</th>
              <th>PASS</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>${escapeHtml(courseDateLabel(c))}</td>
              <td><span class="course-card-status ${courseStatusClass(c)}">${escapeHtml(courseStatusLabel(c))}</span></td>
              <td>${Number(c.requiredMinutes || 0)} min</td>
              <td>${escapeHtml(c.cycle || 'One Time')}</td>
              <td>${escapeHtml(passDisplay(c))}</td>
            </tr>
          </tbody>
        </table>
        ${courseCertificateActionHtml(c)}
      </article>`;

  if (!compact) {
    const groups = {};
    courses.forEach(course => {
      const groupName = courseLibraryDepartment(course);
      if (!groups[groupName]) groups[groupName] = [];
      if (!groups[groupName].some(existing => existing.id === course.id)) groups[groupName].push(course);
    });

    const orderedDepartments = [
      ...DEFAULT_DEPARTMENTS.filter(dep => groups[dep]?.length),
      ...Object.keys(groups).filter(dep => !DEFAULT_DEPARTMENTS.includes(dep)).sort((a, b) => a.localeCompare(b))
    ];

    if (!orderedDepartments.length) return '<div class="empty">No courses available for your library sections.</div>';

    return `<div class="library-department-groups">${orderedDepartments.map(dep => `
      <section class="department-block library-department-block">
        <h3><span>${escapeHtml(dep)}</span><b>${groups[dep].length} ${groups[dep].length === 1 ? 'Course' : 'Courses'}</b></h3>
        <div class="course-cards-grid">${groups[dep].map(courseCardHtml).join('')}</div>
      </section>`).join('')}</div>`;
  }

  const rows = courses.map(c => `
      <tr>
        <td>${escapeHtml(c.courseName)}</td>
        <td>${departmentTooltip(courseDepartments(c))}</td>
        <td>${escapeHtml(courseDateLabel(c))}</td>
        <td>${Number(c.requiredMinutes || 0)}m</td>
        <td>${escapeHtml(c.cycle || 'One Time')}</td>
        <td>${escapeHtml(passDisplay(c))}</td>
        <td><span class="status ${courseStatusClass(c)}">${escapeHtml(courseStatusLabel(c))}</span></td>
        <td>${isCourseMember(c) ? `<button class="btn secondary open-course" data-id="${escapeHtml(c.id)}">${c.completed?'Review':'Open Course'}</button>${c.completed && courseHasCertificate(c) ? ` <button class="btn success download-certificate" data-id="${escapeHtml(c.id)}">Certificate</button>` : ''}` : `<button class="btn secondary request-course" data-id="${escapeHtml(c.id)}">Request Access</button>`}</td>
      </tr>`).join('');
  return `<div class="table-wrap compact-course-table"><table><thead><tr><th>Course</th><th>Department</th><th>Course Date</th><th>Time</th><th>Repetition of this Course</th><th>PASS</th><th>Status</th><th>Action</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function syncAttendanceToolbar() {
  const showActions = !!isManager();
  ['loadAttendanceBtn','exportCsvBtn','exportDocsBtn'].forEach(id => {
    const el = $(id);
    if (el) el.classList.toggle('hidden', !showActions);
  });
}

function renderAttendance() {
  syncAttendanceToolbar();
  const profession = $('attendanceProfession')?.value || '';
  const courseId = $('attendanceCourse')?.value || '';
  let records = state.attendance.slice();
  if (profession) records = records.filter(r => r.profession === profession);
  if (courseId) records = records.filter(r => r.courseId === courseId || r.courseName === courseId);
  $('attendanceBody').innerHTML = records.map((r, i) => {
    const completedAt = toDate(r.completedAt);
    return `<tr><td>${i+1}</td><td>${escapeHtml(r.name)}</td><td>${escapeHtml(r.jobId)}</td><td>${escapeHtml(r.profession)}</td><td>${escapeHtml(r.department)}</td><td>${escapeHtml(r.courseName)}</td><td>${dateOnly(completedAt)}</td><td>${timeOnly(completedAt)}</td><td>${escapeHtml(r.score)}%</td><td>${escapeHtml(r.durationMinutes)} min</td><td>${r.signatureDataUrl ? `<img class="signature-img" src="${r.signatureDataUrl}">` : ''}</td></tr>`;
  }).join('') || '<tr><td colspan="11">No attendance records found.</td></tr>';
}
function fillProfileForm() {
  $('profileName').value = state.profile.name || state.user.displayName || '';
  $('profileJobId').value = state.profile.jobId || '';
  $('profileJobTitle').value = state.profile.jobTitle || '';
  $('profileProfession').value = state.profile.profession || '';
  $('profileMobile').value = state.profile.mobile || '';
  $('profileDepartment').value = state.profile.primaryDepartment || (state.profile.departments || [])[0] || '';
  renderSignaturePreview();
}
function renderSignaturePreview() {
  const box = $('signaturePreview');
  if (state.profile.signatureDataUrl) box.innerHTML = `<img src="${state.profile.signatureDataUrl}" alt="Saved signature">`;
  else box.textContent = 'No signature saved yet.';
}

function showPage(page) {
  state.activePage = page;
  qsa('.page').forEach(p => p.classList.add('hidden'));
  $(`page-${page}`)?.classList.remove('hidden');
  qsa('.nav button').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  const titles = {
    dashboard: ['Home Page / الرئيسية', 'Your assigned learning planner, progress, and attendance evidence.'],
    courses: ['Courses / الكورسات', 'Courses grouped by department with course dates.'],
    attendance: ['Attendance / الحضور', 'Review and export attendance by profession and course.'],
    analytics: ['Analytics / التحليلات', 'Admin and Course Manager analytics. Expand each section to view details.'],
    profile: ['Profile / الملف الشخصي', 'Update profile and e-signature.'],
    admin: ['Admin / الإدارة', 'Build courses and settings.']
  };
  $('pageTitle').textContent = titles[page]?.[0] || titles.dashboard[0];
  $('pageSubtitle').textContent = titles[page]?.[1] || titles.dashboard[1];
  if (page === 'profile') setTimeout(initSignaturePad, 80);
  if (page === 'attendance') renderAttendance();
  if (page === 'analytics') renderAnalytics();
}
function initSignaturePad() {
  const canvas = $('signatureCanvas');
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  if (rect.width < 20 || rect.height < 20) return setTimeout(initSignaturePad, 120);
  const dpr = window.devicePixelRatio || 1;
  const old = state.signatureDirty ? canvas.toDataURL('image/png') : null;
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.lineWidth = 2.4;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#010027';
  state.signatureCtx = ctx;
  state.canvasReady = true;
  if (old) {
    const img = new Image();
    img.onload = () => ctx.drawImage(img, 0, 0, rect.width, rect.height);
    img.src = old;
  } else {
    ctx.clearRect(0,0,rect.width,rect.height);
  }
  if (!canvas.dataset.bound) {
    canvas.addEventListener('pointerdown', startDraw);
    canvas.addEventListener('pointermove', draw);
    window.addEventListener('pointerup', stopDraw);
    canvas.dataset.bound = '1';
  }
}
function pointerPos(e) { const r = $('signatureCanvas').getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
function startDraw(e) { if (!state.canvasReady) initSignaturePad(); state.drawing = true; state.signatureDirty = true; state.signatureHasInk = true; const p = pointerPos(e); state.signatureCtx.beginPath(); state.signatureCtx.moveTo(p.x, p.y); e.preventDefault(); }
function draw(e) { if (!state.drawing || !state.signatureCtx) return; const p = pointerPos(e); state.signatureCtx.lineTo(p.x, p.y); state.signatureCtx.stroke(); e.preventDefault(); }
function stopDraw() { state.drawing = false; }
function clearSignature() { const canvas = $('signatureCanvas'); if (state.signatureCtx && canvas) state.signatureCtx.clearRect(0, 0, canvas.width, canvas.height); state.signatureDirty = true; state.signatureHasInk = false; }
function getCroppedSignature() {
  const canvas = $('signatureCanvas');
  if (!canvas || !state.canvasReady || canvas.width === 0 || canvas.height === 0) return '';
  if (!state.signatureDirty) return state.profile.signatureDataUrl || '';
  const ctx = canvas.getContext('2d');
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = pixels.data;
  let minX = canvas.width, minY = canvas.height, maxX = 0, maxY = 0, found = false;
  for (let y=0; y<canvas.height; y++) {
    for (let x=0; x<canvas.width; x++) {
      const i = (y*canvas.width + x)*4;
      const a = data[i+3];
      const dark = data[i] < 245 || data[i+1] < 245 || data[i+2] < 245;
      if (a > 0 && dark) { found = true; if (x<minX) minX=x; if (y<minY) minY=y; if (x>maxX) maxX=x; if (y>maxY) maxY=y; }
    }
  }
  if (!found) return state.profile.signatureDataUrl || '';
  const pad = 16;
  minX = Math.max(0, minX-pad); minY = Math.max(0, minY-pad); maxX = Math.min(canvas.width, maxX+pad); maxY = Math.min(canvas.height, maxY+pad);
  const w = Math.max(1, maxX-minX); const h = Math.max(1, maxY-minY);
  const out = document.createElement('canvas'); out.width = w; out.height = h;
  out.getContext('2d').drawImage(canvas, minX, minY, w, h, 0, 0, w, h);
  return out.toDataURL('image/png');
}

async function saveProfile() {
  showLoader(20, 'Saving profile...');
  try {
    const signature = getCroppedSignature();
    const profile = {
      name: $('profileName').value.trim(),
      jobId: $('profileJobId').value.trim(),
      jobTitle: $('profileJobTitle').value.trim(),
      profession: $('profileProfession').value,
      mobile: $('profileMobile').value.trim(),
      primaryDepartment: $('profileDepartment').value,
      signatureDataUrl: signature,
      profileCompleted: !!($('profileName').value.trim() && $('profileJobId').value.trim() && $('profileJobTitle').value.trim() && $('profileProfession').value && $('profileDepartment').value && signature),
      updatedAt: serverTimestamp()
    };
    if (!profile.profileCompleted) throw new Error('Please complete profile fields and draw your electronic signature first.');
    await updateDoc(doc(db, 'users', state.user.uid), profile);
    state.profile = { ...state.profile, ...profile };
    state.signatureDirty = false;
    hydrateUserBox();
    renderSignaturePreview();
    toast('Profile saved successfully.', 'success');
    showPage('dashboard');
  } catch (e) { toast(e.message || String(e), 'error'); logClient('saveProfile', e.message || String(e)); }
  hideLoader();
}

function parseFilesText(text) {
  return String(text || '').split('\n').map(x => x.trim()).filter(Boolean).map(line => {
    const parts = line.split('|').map(p => p.trim());
    return parts.length > 1 ? { name: parts[0], url: parts.slice(1).join('|') } : { name: 'Course File', url: line };
  });
}
function getPrimaryContentUrl(course) {
  return course?.contentUrl || (course?.files || []).find(f => f.url)?.url || '';
}
function toEmbedUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  const driveFile = raw.match(/drive\.google\.com\/file\/d\/([^/]+)/);
  if (driveFile) return `https://drive.google.com/file/d/${driveFile[1]}/preview`;
  const openFile = raw.match(/drive\.google\.com\/open\?id=([^&]+)/);
  if (openFile) return `https://drive.google.com/file/d/${openFile[1]}/preview`;
  const presentation = raw.match(/docs\.google\.com\/presentation\/d\/([^/]+)/);
  if (presentation) return `https://docs.google.com/presentation/d/${presentation[1]}/embed?start=false&loop=false&delayms=3000`;
  const documentDoc = raw.match(/docs\.google\.com\/document\/d\/([^/]+)/);
  if (documentDoc) return `https://docs.google.com/document/d/${documentDoc[1]}/preview`;
  const spreadsheet = raw.match(/docs\.google\.com\/spreadsheets\/d\/([^/]+)/);
  if (spreadsheet) return `https://docs.google.com/spreadsheets/d/${spreadsheet[1]}/preview`;
  return raw;
}
function showContentInViewer(url) {
  const embedUrl = toEmbedUrl(url);
  if (!embedUrl) {
    $('contentViewerBox').classList.add('hidden');
    $('openContentNewTabBtn').classList.add('hidden');
    return false;
  }
  $('contentViewer').src = embedUrl;
  $('contentViewerBox').classList.remove('hidden');
  $('openContentNewTabBtn').href = url;
  $('openContentNewTabBtn').classList.remove('hidden');
  return true;
}
function readQuestionsBuilder() {
  return qsa('.question-editor').map((box, idx) => ({
    concept: box.querySelector('.q-concept')?.value.trim() || '',
    question: box.querySelector('.q-text').value.trim(),
    options: {
      A: box.querySelector('.q-a').value.trim(), B: box.querySelector('.q-b').value.trim(),
      C: box.querySelector('.q-c').value.trim(), D: box.querySelector('.q-d').value.trim()
    },
    correct: box.querySelector('.q-correct').value,
    rationale: box.querySelector('.q-rationale').value.trim(),
    order: idx + 1
  })).filter(q => q.question);
}
async function saveCourse() {
  try {
    const departments = selectedCourseDepartments();
    if (!departments.length) throw new Error('Please select at least one department first.');
    const blocked = departments.filter(d => !canManageDepartment(d));
    if (blocked.length) throw new Error(`This Course Manager is not assigned to: ${blocked.join(', ')}. Super Admin must add these departments to the user access first.`);
    const department = departments[0];
    const courseName = $('courseName').value.trim();
    if (!courseName) throw new Error('Course Name is required.');
    const courseKey = normalizeCourseName(courseName);
    const courseDate = $('courseDate')?.value || dateOnly(new Date());
    const explicitId = $('courseId').value.trim();
    const id = explicitId || stableCourseIdFromName(courseName);
    const duplicate = state.courseNameIndex.find(course => course.id !== id && (course.courseKey || normalizeCourseName(course.courseName)) === courseKey);
    if (duplicate) throw new Error(`A course with the same name already exists: ${duplicate.courseName}`);

    const ref = doc(db, 'courses', id);
    const oldCourse = state.courses.find(course => course.id === id);
    if (oldCourse && !explicitId) throw new Error('A course with the same name already exists. Open it from Managed Courses to edit it.');
    if (oldCourse && !canEditCourse(oldCourse)) throw new Error('Only the original course publisher or Super Admin can update this course.');

    const featureImageFile = $('courseFeatureImageFile')?.files?.[0] || null;
    const existingFeatureImageDataUrl = oldCourse?.featureImageDataUrl || oldCourse?.sliderImageDataUrl || '';
    const featureImageDataUrl = featureImageFile ? await imageFileToCourseDataUrl(featureImageFile) : existingFeatureImageDataUrl;


    const baseData = {
      courseName, courseKey, courseDate, department, departments,
      contentUrl: $('courseContentUrl').value.trim(),
      requiredMinutes: Number($('courseRequiredMinutes').value || 0),
      passScore: Number($('coursePassScore').value || 0),
      questionDisplayCount: Number($('courseQuestionDisplayCount')?.value || 0),
      cycle: $('courseCycle').value, status: $('courseStatus').value,
      enrollmentMode: 'Department',
      brief: $('courseBrief').value.trim(), description: $('courseDescription').value.trim(),
      featureImageUrl: $('courseFeatureImageUrl')?.value.trim() || '',
      sliderImageUrl: $('courseFeatureImageUrl')?.value.trim() || '',
      featureImageDataUrl,
      sliderImageDataUrl: featureImageDataUrl,
      files: parseFilesText($('courseFiles').value), questions: readQuestionsBuilder(),
      certificateTemplateUrl: $('courseCertificateTemplateUrl')?.value.trim() || '',
      certificateGeneratorUrl: window.CARELEARN_CERTIFICATE_WEBAPP_URL || localStorage.getItem('carelearn.certificateScriptUrl') || $('certificateScriptUrl')?.value.trim() || oldCourse?.certificateGeneratorUrl || DEFAULT_CERTIFICATE_GENERATOR_URL || '',
      updatedAt: serverTimestamp(), updatedBy: state.user.email
    };

    const currentPublisher = {
      publisherUid: state.user.uid,
      publisherEmail: state.user.email,
      publisherName: shortDisplayName(state.profile?.name || state.user.displayName || state.user.email),
      publisherDepartment: state.profile?.primaryDepartment || (state.profile?.departments || [])[0] || department,
      publisherLibraryDepartment: publisherLibraryDepartment(state.profile) || state.profile?.primaryDepartment || (state.profile?.departments || [])[0] || department,
      publisherSignatureDataUrl: state.profile?.signatureDataUrl || ''
    };

    const preservedPublisher = oldCourse ? {
      publisherUid: oldCourse.publisherUid || oldCourse.postedByUid || oldCourse.managerUid || oldCourse.createdByUid || currentPublisher.publisherUid,
      publisherEmail: oldCourse.publisherEmail || oldCourse.postedByEmail || oldCourse.managerEmail || oldCourse.createdByEmail || oldCourse.createdBy || currentPublisher.publisherEmail,
      publisherName: oldCourse.publisherName || oldCourse.postedByName || oldCourse.createdByName || oldCourse.managerName || coursePublisherName(oldCourse) || currentPublisher.publisherName,
      publisherDepartment: oldCourse.publisherDepartment || oldCourse.postedByDepartment || oldCourse.createdByDepartment || coursePublisherDepartment(oldCourse) || currentPublisher.publisherDepartment,
      publisherLibraryDepartment: oldCourse.publisherLibraryDepartment || oldCourse.libraryDepartment || oldCourse.courseLibraryDepartment || courseLibraryDepartment(oldCourse) || currentPublisher.publisherLibraryDepartment,
      publisherSignatureDataUrl: oldCourse.publisherSignatureDataUrl || oldCourse.publisherSignature || (isCourseOriginalPublisher(oldCourse) ? currentPublisher.publisherSignatureDataUrl : '') || coursePublisherSignatureDataUrl(oldCourse) || currentPublisher.publisherSignatureDataUrl
    } : currentPublisher;

    if (oldCourse) {
      await updateDoc(ref, {
        ...baseData,
        ...preservedPublisher,
        managerUid: oldCourse.managerUid || preservedPublisher.publisherUid || state.user.uid,
        managerEmail: oldCourse.managerEmail || preservedPublisher.publisherEmail || state.user.email
      });
    } else {
      await setDoc(ref, {
        ...baseData,
        ...currentPublisher,
        memberIds: [],
        managerUid: state.user.uid,
        managerEmail: state.user.email,
        createdAt: serverTimestamp(),
        createdBy: state.user.email
      });
    }

    await audit(oldCourse ? 'UPDATE_COURSE' : 'CREATE_COURSE', 'Course', id);
    await loadCourses(); await loadManagerData(); renderAll(); renderCourseManagement(); toast('Course saved successfully.', 'success');
  } catch (e) {
    const msg = e.code === 'permission-denied'
      ? 'Missing permission. Make sure Firestore rules are deployed and this Course Manager is assigned to the selected department.'
      : (e.message || String(e));
    toast(msg, 'error');
    }
}
function addQuestionEditor(q={}) {
  const wrap = document.createElement('div');
  wrap.className = 'question-editor';
  wrap.innerHTML = `<div class="form-grid">
    <label class="q-concept-wrap">Concept<input class="q-concept" value="${escapeHtml(q.concept||'')}" placeholder="Example: Medication Safety / Infection Control"></label>
    <label class="full">Question<input class="q-text" value="${escapeHtml(q.question||'')}"></label>
    <label>Option A<input class="q-a" value="${escapeHtml(q.options?.A||'')}"></label>
    <label>Option B<input class="q-b" value="${escapeHtml(q.options?.B||'')}"></label>
    <label>Option C<input class="q-c" value="${escapeHtml(q.options?.C||'')}"></label>
    <label>Option D<input class="q-d" value="${escapeHtml(q.options?.D||'')}"></label>
    <label>Correct<select class="q-correct"><option>A</option><option>B</option><option>C</option><option>D</option></select></label>
    <label>Rationale<input class="q-rationale" value="${escapeHtml(q.rationale||'')}"></label>
  </div><button class="btn secondary remove-question" type="button">Remove</button>`;
  wrap.querySelector('.q-correct').value = q.correct || 'A';
  wrap.querySelector('.remove-question').addEventListener('click', () => wrap.remove());
  $('questionsBuilder').appendChild(wrap);
}
async function openCourse(id) {
  const course = state.courses.find(c => c.id === id);
  if (!course) return;
  if (!isCourseMember(course)) return toast('This course requires approval before you can open it.', 'warn');
  state.currentCourse = course;
  state.currentQuiz = [];
  state.activeSeconds = 0;
  state.startedAt = new Date();

  const publisherName = coursePublisherName(course);
  const publisherDepartment = coursePublisherDepartment(course);
  const courseBrief = String(course.brief || '').trim();
  const courseDescription = String(course.description || '').trim();
  const shouldShowDescription = !!courseDescription && courseDescription.toLowerCase() !== courseBrief.toLowerCase();

  $('modalCourseTitle').textContent = course.courseName;
  $('modalCourseMeta').textContent = `${course.department} · ${course.requiredMinutes || 0} min · Pass ${course.passScore || 0}% · ${course.cycle || 'One Time'}`;
  $('courseHero').innerHTML = `
    <div class="course-hero-main">
      <span class="course-hero-kicker">Course Overview</span>
      <h3>${escapeHtml(course.courseName)}</h3>
      <div class="course-publisher-meta">
        <span>Posted By : <strong>${escapeHtml(publisherName)}</strong></span>
        <span>Primary Department : <strong>${escapeHtml(publisherDepartment)}</strong></span>
      </div>
      ${courseBrief ? `<p class="course-brief-text">${escapeHtml(courseBrief)}</p>` : ''}
    </div>`;

  const descEl = $('modalCourseDescription');
  if (shouldShowDescription) {
    descEl.classList.remove('hidden');
    descEl.innerHTML = `<span class="course-description-label">Description</span><span>${escapeHtml(courseDescription)}</span>`;
  } else {
    descEl.classList.add('hidden');
    descEl.innerHTML = '';
  }

  $('completedNotice').classList.toggle('hidden', !course.completed);
  $('completedNotice').textContent = course.completed ? 'You have already completed this course. You can review the content, selected answers, and correct answers without changing attendance, score, signature, or duration.' : '';
  renderCertificateBox(course);
  $('submitCourseBtn').classList.toggle('hidden', !!course.completed);
  $('timerPanel').classList.toggle('hidden', !!course.completed);
  const primaryUrl = getPrimaryContentUrl(course);
  showContentInViewer(primaryUrl);
  $('courseFilesBox').innerHTML = (course.files || []).map(f => `<button class="file-link-btn" type="button" data-url="${escapeHtml(f.url)}">${escapeHtml(f.name)}</button>`).join('');
  qsa('.file-link-btn').forEach(btn => btn.addEventListener('click', () => showContentInViewer(btn.dataset.url)));
  renderQuiz(course, { review: !!course.completed, record: course.completedRecord || null });
  $('courseModal').classList.remove('hidden');
  $('courseModal').classList.add('course-page-mode');
  if (!course.completed) startTimer();
  await updateDoc(doc(db, 'courses', course.id), { lastOpenedAt: serverTimestamp() }).catch(()=>{});
  await audit(course.completed ? 'REVIEW_COURSE' : 'OPEN_COURSE', 'Course', course.id);
}
function closeCourseModal() { $('courseModal').classList.add('hidden'); $('courseModal').classList.remove('course-page-mode'); stopTimer(); }
function openMainContent() {
  const url = getPrimaryContentUrl(state.currentCourse);
  if (!showContentInViewer(url)) toast('No course content URL or file attachment added.', 'warn');
}
function startTimer() { stopTimer(); updateTimer(); state.timer = setInterval(() => { state.activeSeconds += document.hidden ? 0 : 1; updateTimer(); }, 1000); }
function stopTimer() { if (state.timer) clearInterval(state.timer); state.timer = null; }
function updateTimer() {
  const required = Number(state.currentCourse?.requiredMinutes || 0) * 60;
  const pct = required ? Math.min(100, state.activeSeconds / required * 100) : 100;
  $('timerText').textContent = mmss(state.activeSeconds);
  $('timeProgress').style.width = `${pct}%`;
  $('timeHint').textContent = required ? `Required: ${state.currentCourse.requiredMinutes} minutes. Current progress: ${Math.round(pct)}%.` : 'No minimum time required.';
}

function hashString(seed) {
  let hash = 2166136261;
  const str = String(seed || '');
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
function seededShuffle(items, seed) {
  const arr = items.slice();
  let stateSeed = hashString(seed) || 1;
  const random = () => {
    stateSeed = Math.imul(1664525, stateSeed) + 1013904223 >>> 0;
    return stateSeed / 4294967296;
  };
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function buildQuizItems(course, record=null) {
  const questions = course?.questions || [];
  const reviewItems = record?.quizReview?.items || [];
  if (reviewItems.length) {
    return reviewItems.map((item, idx) => ({
      originalIndex: Number(item.originalIndex ?? idx),
      optionKeys: item.optionKeys || ['A','B','C','D'].filter(k => item.options?.[k]),
      q: {
        concept: item.concept || '',
        question: item.question || '',
        options: item.options || {},
        correct: item.correct || '',
        rationale: item.rationale || ''
      },
      selected: item.selected || '',
      isCorrect: !!item.isCorrect
    }));
  }

  const seedBase = `${state.user?.uid || ''}_${course?.id || ''}_${currentCycle(course || {})}`;
  const indexedQuestions = questions.map((q, originalIndex) => ({ q, originalIndex }));
  const shuffledQuestions = seededShuffle(indexedQuestions, `${seedBase}_questions`);
  const requestedCount = Number(course?.questionDisplayCount || 0);
  const displayCount = requestedCount > 0 ? Math.min(requestedCount, shuffledQuestions.length) : shuffledQuestions.length;
  return shuffledQuestions.slice(0, displayCount).map(item => ({
    ...item,
    optionKeys: seededShuffle(['A','B','C','D'].filter(k => item.q.options?.[k]), `${seedBase}_q_${item.originalIndex}_options`)
  }));
}
function renderQuiz(courseOrQuestions, options={}) {
  const course = Array.isArray(courseOrQuestions) ? { questions: courseOrQuestions } : (courseOrQuestions || state.currentCourse || {});
  const questions = course.questions || [];
  const review = !!options.review;
  const record = options.record || null;
  const items = buildQuizItems(course, record);
  state.currentQuiz = review ? [] : items;

  if (!questions.length) {
    $('quizBox').innerHTML = '<div class="quiz-empty">No MCQ questions for this course. Completion depends on the required learning time only.</div>';
    return;
  }

  const scoreText = record?.score !== undefined ? `${record.score}%` : `${Number(course.passScore || 0)}% pass`;
  $('quizBox').innerHTML = `
    <div class="quiz-shell ${review ? 'quiz-review-mode' : ''}">
      <div class="quiz-summary">
        <div>
          <h3>${review ? 'Quiz Review' : 'Competency Check'}</h3>
          <p>${review ? 'Review the exact questions shown to you, your selected answers, and the correct answers.' : `Answer ${items.length} of ${questions.length} shuffled question${questions.length === 1 ? '' : 's'}. Options are shuffled for each employee.`}</p>
        </div>
        <span class="quiz-summary-badge">${escapeHtml(scoreText)}</span>
      </div>
      <div class="quiz-list">
        ${items.map((item, displayIndex) => {
          const q = item.q;
          const originalIndex = item.originalIndex;
          const selected = item.selected || '';
          const correct = q.correct || '';
          return `<div class="quiz-question">
            <div class="quiz-question-header">
              ${q.concept ? `<span class="quiz-concept">${escapeHtml(q.concept)}</span>` : ''}
              <strong>${displayIndex + 1}. ${escapeHtml(q.question)}</strong>
            </div>
            <div class="quiz-options">
              ${(item.optionKeys || []).map((k, optionIndex) => {
                const isCorrect = review && k === correct;
                const isWrong = review && selected === k && selected !== correct;
                const isSelected = review && selected === k;
                const label = String.fromCharCode(65 + optionIndex);
                return `<label class="quiz-option ${isCorrect ? 'correct' : ''} ${isWrong ? 'wrong' : ''}">
                  <input type="radio" name="q_${originalIndex}" value="${k}" data-index="${originalIndex}" ${isSelected ? 'checked' : ''} ${review ? 'disabled' : ''}>
                  <span class="quiz-option-letter">${label}</span>
                  <span class="quiz-option-text">${escapeHtml(q.options?.[k] || '')}</span>
                  ${review ? `<span class="quiz-option-mark">${isCorrect ? 'Correct answer' : isWrong ? 'Your answer' : ''}</span>` : '<span class="quiz-option-mark"></span>'}
                </label>`;
              }).join('')}
            </div>
            ${review ? `<div class="quiz-review-answer">
              <div>Your answer: <span>${selected ? escapeHtml(q.options?.[selected] || selected) : 'Not answered'}</span></div>
              <div>Correct answer: <span>${correct ? escapeHtml(q.options?.[correct] || correct) : 'Not set'}</span></div>
              ${q.rationale ? `<div>Rationale: <span>${escapeHtml(q.rationale)}</span></div>` : ''}
            </div>` : ''}
          </div>`;
        }).join('')}
      </div>
    </div>`;
}
function collectAnswers() {
  const answers = {};
  state.currentQuiz.forEach(item => {
    const checked = document.querySelector(`input[name="q_${item.originalIndex}"]:checked`);
    answers[item.originalIndex] = checked ? checked.value : '';
  });
  return answers;
}
function scoreQuiz(questions, answers) {
  const items = state.currentQuiz.length ? state.currentQuiz : (questions || []).map((q, originalIndex) => ({ q, originalIndex }));
  if (!items.length) return 100;
  const correct = items.filter(item => (answers[item.originalIndex] || '') === item.q.correct).length;
  return Math.round(correct / items.length * 100);
}
function buildQuizReviewPayload(answers) {
  return {
    questionDisplayCount: Number(state.currentCourse?.questionDisplayCount || 0),
    totalQuestionBank: (state.currentCourse?.questions || []).length,
    displayedCount: state.currentQuiz.length,
    items: state.currentQuiz.map((item, displayIndex) => {
      const selected = answers[item.originalIndex] || '';
      const correct = item.q.correct || '';
      return {
        displayIndex: displayIndex + 1,
        originalIndex: item.originalIndex,
        concept: item.q.concept || '',
        question: item.q.question || '',
        options: item.q.options || {},
        optionKeys: item.optionKeys || [],
        correct,
        selected,
        isCorrect: selected === correct,
        rationale: item.q.rationale || ''
      };
    })
  };
}
async function submitCourse() {
  const course = state.currentCourse;
  if (!course || course.completed) return;
  if (!isCourseMember(course)) return toast('This course requires approval before attendance can be recorded.', 'warn');
  const required = Number(course.requiredMinutes || 0) * 60;
  if (required && state.activeSeconds < required) return toast('Minimum required learning time has not been completed yet.', 'warn');

  const questions = course.questions || [];
  if (questions.length && !state.currentQuiz.length) renderQuiz(course);
  const answers = collectAnswers();
  if (questions.length && Object.values(answers).filter(Boolean).length < state.currentQuiz.length) return toast('Please answer all displayed MCQ questions.', 'warn');

  const score = scoreQuiz(questions, answers);
  if (score < Number(course.passScore || 0)) return toast(`Score ${score}%. Passing score is ${course.passScore}%. Attendance was not recorded.`, 'error');

  const cycle = currentCycle(course);
  const attendanceId = `${state.user.uid}_${course.id}_${cycle}`;
  const completedAt = new Date();
  const rec = {
    userId: state.user.uid, email: state.user.email,
    name: state.profile.name, jobId: state.profile.jobId, jobTitle: state.profile.jobTitle, profession: state.profile.profession,
    department: state.profile.primaryDepartment || (state.profile.departments || [])[0] || course.department,
    courseId: course.id, courseName: course.courseName, cycle,
    score, durationMinutes: Math.round(state.activeSeconds / 60 * 100) / 100,
    certificateId: `${state.user.uid}_${course.id}_${cycle}`,
    certificateTemplateUrl: courseCertificateTemplateUrl(course),
    signatureDataUrl: state.profile.signatureDataUrl,
    quizReview: questions.length ? buildQuizReviewPayload(answers) : { displayedCount: 0, items: [] },
    completedAt: Timestamp.fromDate(completedAt), createdAt: serverTimestamp()
  };
  try {
    await setDoc(doc(db, 'attendance', attendanceId), rec);
    toast('Course completed successfully. Attendance recorded.', 'success');
    await audit('COURSE_COMPLETED', 'Course', course.id, { score, displayedQuestions: state.currentQuiz.length });
    closeCourseModal();
    await loadAttendance(); await loadCourses(); renderAll();
  } catch (e) { toast(e.message || String(e), 'error'); }
}
function exportCsv() {
  const rows = filteredAttendance();
  const header = ['SN','Name','Job ID','Profession','Department','Course','Date','Time','Score','Duration'];
  const csv = [header].concat(rows.map((r,i)=>[i+1,r.name,r.jobId,r.profession,r.department,r.courseName,dateOnly(r.completedAt),timeOnly(r.completedAt),r.score,r.durationMinutes])).map(row => row.map(v => `"${String(v ?? '').replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `CareLearn_Attendance_${Date.now()}.csv`; a.click();
}
function filteredAttendance() {
  const profession = $('attendanceProfession')?.value || '';
  const courseId = $('attendanceCourse')?.value || '';
  return state.attendance.filter(r =>
    (!profession || r.profession === profession) &&
    (!courseId || r.courseId === courseId || r.courseName === courseId)
  );
}
async function exportDocs() {
  const url = appsScriptExportUrl();
  if (!url) return toast('Add Apps Script Export Web App URL in Admin > Export Settings.', 'warn');
  const rows = filteredAttendance();
  if (!rows.length) return toast('No attendance records to export.', 'warn');
  const idToken = await state.user.getIdToken();
  const payload = {
    idToken,
    exportedBy: state.user.email,
    filters: { profession: $('attendanceProfession')?.value || '', courseId: $('attendanceCourse')?.value || '' },
    records: rows.map(r => ({
      name:r.name, jobId:r.jobId, position:r.jobTitle || r.profession, profession:r.profession, department:r.department, courseName:r.courseName,
      date:dateOnly(r.completedAt), time:timeOnly(r.completedAt), score:r.score, durationMinutes:r.durationMinutes, signatureDataUrl:r.signatureDataUrl
    }))
  };
  $('docsExportForm').action = url;
  $('docsPayload').value = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
  $('docsExportForm').submit();
}
function saveLocalSettings() {
  const url = $('appsScriptUrl')?.value.trim() || DEFAULT_APPS_SCRIPT_EXPORT_URL || '';
  const certUrl = $('certificateScriptUrl')?.value.trim() || DEFAULT_CERTIFICATE_GENERATOR_URL || '';
  localStorage.setItem('carelearn.appsScriptUrl', url);
  localStorage.setItem('carelearn.certificateScriptUrl', certUrl);
  toast('Local settings saved in this browser.', 'success');
}
function applyTheme(theme) {
  document.body.dataset.theme = 'light';
  localStorage.setItem('carelearn.theme', 'light');
  if ($('themeToggleBtn')) $('themeToggleBtn').textContent = 'Light Mode';
}
function toggleTheme() {
  applyTheme('light');
}
function fileToPayload(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({
      name: file.name,
      mimeType: file.type || 'application/octet-stream',
      dataUrl: reader.result
    });
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
async function uploadCourseFiles() {
  const url = appsScriptExportUrl();
  if (!url) return toast('Add Apps Script Web App URL in Admin > Export Settings first.', 'warn');
  const files = Array.from($('courseUploadFiles').files || []);
  if (!files.length) return toast('Choose one or more course files first.', 'warn');
  const uploadWindowName = 'carelearnCourseUpload';
  const uploadWindow = window.open('', uploadWindowName, 'width=560,height=520');
  if (!uploadWindow) return toast('Please allow popups so the Drive upload window can open.', 'warn');
  uploadWindow.document.write('<p style="font-family:Arial;padding:24px">Preparing upload...</p>');
  showLoader(15, 'Preparing files for Drive upload...');
  try {
    const uploadId = `upload_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const payload = {
      action: 'uploadCourseFiles',
      uploadId,
      idToken: await state.user.getIdToken(),
      courseName: $('courseName').value.trim() || 'Untitled Course',
      files: await Promise.all(files.map(fileToPayload))
    };
    const form = document.createElement('form');
    form.method = 'post';
    form.action = url;
    form.target = uploadWindowName;
    form.className = 'hidden';
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = 'payload';
    input.value = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
    form.appendChild(input);
    document.body.appendChild(form);
    form.submit();
    form.remove();
    showLoader(60, 'Uploading files to Super Admin Drive...');
    pollUploadResult(url, uploadId);
  } catch (e) {
    try { uploadWindow.close(); } catch (ex) {}
    hideLoader();
    toast(e.message || String(e), 'error');
  }
}
function pollUploadResult(url, uploadId, attempt=0) {
  if (attempt > 90) {
    hideLoader();
    return toast('Upload finished, but the app could not read the Drive links. Please copy them from the upload window or try again.', 'warn');
  }
  const callbackName = `carelearnUploadStatus_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const script = document.createElement('script');
  const sep = url.includes('?') ? '&' : '?';
  window[callbackName] = (data) => {
    delete window[callbackName];
    script.remove();
    if (data?.status === 'complete') {
      handleUploadMessage({ data: { type: 'carelearn-upload-complete', files: data.files || [] } });
    } else if (data?.status === 'error') {
      handleUploadMessage({ data: { type: 'carelearn-upload-complete', error: data.error || 'Upload failed.' } });
    } else {
      setTimeout(() => pollUploadResult(url, uploadId, attempt + 1), 2000);
    }
  };
  script.onerror = () => {
    delete window[callbackName];
    script.remove();
    setTimeout(() => pollUploadResult(url, uploadId, attempt + 1), 2500);
  };
  script.src = `${url}${sep}action=uploadStatus&uploadId=${encodeURIComponent(uploadId)}&callback=${encodeURIComponent(callbackName)}&ts=${Date.now()}`;
  document.body.appendChild(script);
}
function handleUploadMessage(event) {
  const data = event.data || {};
  if (data.type !== 'carelearn-upload-complete') return;
  hideLoader();
  if (data.error) return toast(data.error, 'error');
  const lines = (data.files || []).map(f => `${f.name} | ${f.url}`);
  $('courseFiles').value = [$('courseFiles').value.trim(), ...lines].filter(Boolean).join('\n');
  const firstImage = (data.files || []).find(f => /\.(png|jpe?g|webp|gif)$/i.test(f.name || '') || String(f.mimeType || '').startsWith('image/'));
  if (firstImage && $('courseFeatureImageUrl') && !$('courseFeatureImageUrl').value.trim()) $('courseFeatureImageUrl').value = firstImage.url || '';
  $('courseUploadFiles').value = '';
  toast(`${lines.length} file(s) uploaded and attached.`, 'success');
}

async function requestCourseAccess(courseId) {
  const course = state.courses.find(c => c.id === courseId);
  if (!course) return;
  const requestId = `${state.user.uid}_${courseId}`;
  const ref = doc(db, 'courseRequests', requestId);
  const existing = await getDoc(ref);
  if (existing.exists()) return toast('Your request was already submitted for this course.', 'warn');
  await setDoc(ref, {
    courseId,
    courseName: course.courseName,
    requesterUid: state.user.uid,
    requesterEmail: state.user.email,
    requesterName: state.profile.name || state.user.displayName || '',
    requesterJobId: state.profile.jobId || '',
    requesterDepartment: state.profile.primaryDepartment || (state.profile.departments || [])[0] || '',
    status: 'Pending',
    createdAt: serverTimestamp()
  });
  await audit('REQUEST_COURSE_ACCESS', 'Course', courseId);
  toast('Access request sent to the Course Manager.', 'success');
}
function bindOpenButtons() {
  bindCertificateButtons();
  qsa('.open-course').forEach(btn => {
    if (btn.dataset.bound === '1') return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      openCourse(btn.dataset.id);
    });
  });
  qsa('.request-course').forEach(btn => {
    if (btn.dataset.bound === '1') return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      requestCourseAccess(btn.dataset.id);
    });
  });
  qsa('.course-card-clickable').forEach(card => {
    if (card.dataset.bound === '1') return;
    card.dataset.bound = '1';
    const run = () => {
      if (card.dataset.action === 'request') return requestCourseAccess(card.dataset.id);
      return openCourse(card.dataset.id);
    };
    card.addEventListener('click', (event) => {
      if (event.target.closest('.department-card-tooltip, .tooltip-panel, .info-circle, button, a, input, select, textarea')) return;
      run();
    });
    card.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      run();
    });
  });
}
function managedCoursesOptions() {
  return state.courses.filter(canManageCourse).map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.courseName)}</option>`).join('');
}
function renderCourseManagement() {
  const box = $('courseManagementBox');
  if (!box) return;
  const managed = state.courses.filter(canManageCourse);
  box.classList.toggle('hidden', !managed.length);
  if (!managed.length) return;
  $('memberCourseSelect').innerHTML = managedCoursesOptions();
  $('requestCourseSelect').innerHTML = managedCoursesOptions();
  $('addDepartmentMembersBtn')?.classList.toggle('hidden', !isSuperAdmin());
  renderManagedCourses();
  renderMembersList();
  renderRequestsList();
}
function renderManagedCourses() {
  const body = $('managedCoursesBody');
  if (!body) return;
  const managed = state.courses.filter(canManageCourse);
  body.innerHTML = managed.length ? managed.map(c => {
    const canEdit = canEditCourse(c);
    return `
    <tr>
      <td>${escapeHtml(c.courseName)}</td>
      <td>${escapeHtml(courseDepartments(c).join(', '))}</td>
      <td>${escapeHtml(c.cycle || 'Monthly')}</td>
      <td><span class="status ${c.status === 'Active' ? 'completed' : 'locked'}">${escapeHtml(c.status || 'Active')}</span></td>
      <td>${(c.memberIds || []).length}</td>
      <td>${canEdit
        ? `<button class="btn secondary edit-course" data-id="${escapeHtml(c.id)}">Edit</button> <button class="btn secondary deactivate-course" data-id="${escapeHtml(c.id)}">Deactivate</button>${courseHasCertificate(c) ? ` <a class="btn secondary certificate-design-link" href="${escapeHtml(courseCertificateTemplateUrl(c))}" target="_blank" rel="noopener">Certificate Design</a>` : ''}`
        : `<span class="status locked">View Only</span>`}</td>
    </tr>`;
  }).join('') : '<tr><td colspan="6">No managed courses yet.</td></tr>';
  qsa('.edit-course').forEach(btn => btn.addEventListener('click', () => editCourse(btn.dataset.id)));
  qsa('.deactivate-course').forEach(btn => btn.addEventListener('click', () => deactivateCourse(btn.dataset.id)));
}
function editCourse(id) {
  const c = state.courses.find(x => x.id === id);
  if (!c) return;
  if (!canEditCourse(c)) return toast('Only the original course publisher or Super Admin can edit this course.', 'error');
  $('courseId').value = c.id;
  $('courseName').value = c.courseName || '';
  if ($('courseDate')) $('courseDate').value = courseDateValue(c);
  qsa('#courseDepartment option').forEach(opt => { opt.selected = courseDepartments(c).includes(opt.value); });
  $('courseContentUrl').value = c.contentUrl || '';
  $('courseRequiredMinutes').value = Number(c.requiredMinutes || 0);
  $('coursePassScore').value = Number(c.passScore || 0);
  if ($('courseQuestionDisplayCount')) $('courseQuestionDisplayCount').value = Number(c.questionDisplayCount || 0);
  $('courseCycle').value = c.cycle === 'Annual' ? 'Yearly' : (c.cycle || 'Monthly');
  $('courseStatus').value = c.status || 'Active';
  $('courseBrief').value = c.brief || '';
  $('courseDescription').value = c.description || '';
  $('courseFiles').value = (c.files || []).map(f => `${f.name || 'Course File'} | ${f.url}`).join('\n');
  if ($('courseFeatureImageUrl')) $('courseFeatureImageUrl').value = c.featureImageUrl || c.sliderImageUrl || '';
  if ($('courseFeatureImageFile')) $('courseFeatureImageFile').value = '';
  if ($('courseCertificateTemplateUrl')) $('courseCertificateTemplateUrl').value = courseCertificateTemplateUrl(c);
  $('questionsBuilder').innerHTML = '';
  (c.questions || []).forEach(addQuestionEditor);
  toast('Course loaded for editing.', 'success');
}
async function deactivateCourse(id) {
  const course = state.courses.find(c => c.id === id);
  if (!course || !canEditCourse(course)) return toast('Only the original course publisher or Super Admin can deactivate this course.', 'error');
  await updateDoc(doc(db, 'courses', id), { status: 'Inactive', updatedAt: serverTimestamp(), updatedBy: state.user.email });
  await audit('DEACTIVATE_COURSE', 'Course', id);
  await loadCourses(); await loadManagerData(); renderAll();
  toast('Course deactivated.', 'success');
}
function renderRoleAdmin() {
  const box = $('roleAdminBox');
  if (!box) return;
  box.classList.toggle('hidden', !isSuperAdmin());
  if (!isSuperAdmin()) return;
  $('adminUserSelect').innerHTML = state.users.map(u => `<option value="${escapeHtml(u.id)}">${escapeHtml(u.name || u.email || u.id)} - ${escapeHtml(roleLabels[canonicalRole(u.role)] || u.role || 'User')}</option>`).join('');
  $('adminDepartmentsSelect').innerHTML = DEFAULT_DEPARTMENTS.map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('');
  if ($('publisherLibraryDepartmentOptions')) {
    $('publisherLibraryDepartmentOptions').innerHTML = libraryDepartmentOptions().map(d => `<option value="${escapeHtml(d)}"></option>`).join('');
  }
  syncRoleEditor();
}
function syncRoleEditor() {
  if (!$('adminUserSelect')) return;
  const user = state.users.find(u => u.id === $('adminUserSelect').value) || state.users[0];
  if (!user) return;
  $('adminUserSelect').value = user.id;
  $('adminRoleSelect').value = canonicalRole(user.role);
  const deps = accessDepartments(user);
  qsa('#adminDepartmentsSelect option').forEach(opt => { opt.selected = deps.includes(opt.value); });
  if ($('adminPublisherLibraryDepartment')) {
    $('adminPublisherLibraryDepartment').value = publisherLibraryDepartment(user) || user.primaryDepartment || deps[0] || '';
  }
}
async function saveUserRoleAccess() {
  const uid = $('adminUserSelect').value;
  const user = state.users.find(u => u.id === uid);
  if (!user) return toast('Select a user first.', 'warn');
  const departments = qsa('#adminDepartmentsSelect option').filter(o => o.selected).map(o => o.value);
  const role = $('adminRoleSelect').value;
  const publisherLibraryDept = String($('adminPublisherLibraryDepartment')?.value || '').trim();
  await updateDoc(doc(db, 'users', uid), {
    role,
    departments,
    managedDepartments: departments,
    primaryDepartment: user.primaryDepartment || departments[0] || publisherLibraryDept || '',
    publisherLibraryDepartment: publisherLibraryDept || user.publisherLibraryDepartment || user.primaryDepartment || departments[0] || '',
    updatedAt: serverTimestamp()
  });
  await audit('UPDATE_USER_ACCESS', 'User', uid, { role, departments, publisherLibraryDepartment: publisherLibraryDept });
  await loadManagerData();
  await loadCourses();
  renderRoleAdmin();
  renderAll();
  toast('User access updated.', 'success');
}
function renderMembersList() {
  const course = state.courses.find(c => c.id === $('memberCourseSelect').value) || state.courses.filter(canManageCourse)[0];
  if (!course) return;
  const members = course.memberIds || [];
  $('membersList').innerHTML = members.length ? members.map(id => {
    const user = state.users.find(u => u.id === id) || {};
    return `<div class="member-row"><span><strong>${escapeHtml(user.name || user.email || id)}</strong><small>${escapeHtml(user.jobId || '')} ${escapeHtml(user.primaryDepartment || '')}</small></span><button class="btn secondary remove-member" data-course="${escapeHtml(course.id)}" data-user="${escapeHtml(id)}">Remove</button></div>`;
  }).join('') : '<div class="empty">No members assigned yet.</div>';
  qsa('.remove-member').forEach(btn => btn.addEventListener('click', () => removeCourseMember(btn.dataset.course, btn.dataset.user)));
}
function renderRequestsList() {
  const courseId = $('requestCourseSelect').value;
  const requests = state.courseRequests.filter(r => (!courseId || r.courseId === courseId) && r.status === 'Pending');
  $('requestsList').innerHTML = requests.length ? requests.map(r => `<div class="member-row"><span><strong>${escapeHtml(r.requesterName || r.requesterEmail)}</strong><small>${escapeHtml(r.courseName)} | ${escapeHtml(r.requesterJobId || '')}</small></span><span class="actions-inline"><button class="btn success approve-request" data-id="${escapeHtml(r.id)}" data-course="${escapeHtml(r.courseId)}" data-user="${escapeHtml(r.requesterUid)}">Approve</button><button class="btn secondary reject-request" data-id="${escapeHtml(r.id)}">Reject</button></span></div>`).join('') : '<div class="empty">No pending requests.</div>';
  qsa('.approve-request').forEach(btn => btn.addEventListener('click', () => approveCourseRequest(btn.dataset.id, btn.dataset.course, btn.dataset.user)));
  qsa('.reject-request').forEach(btn => btn.addEventListener('click', () => rejectCourseRequest(btn.dataset.id)));
}
async function addCourseMember() {
  const courseId = $('memberCourseSelect').value;
  const needle = $('memberSearch').value.trim().toLowerCase();
  const course = state.courses.find(c => c.id === courseId);
  if (!course || !canManageCourse(course)) return toast('You cannot manage this course.', 'error');
  const user = state.users.find(u => [u.email, u.name, u.jobId].some(v => String(v || '').toLowerCase() === needle));
  if (!user) return toast('No matching user found by exact email, name, or Job ID.', 'warn');
  await updateDoc(doc(db, 'courses', courseId), { memberIds: arrayUnion(user.id), updatedAt: serverTimestamp() });
  await audit('ADD_COURSE_MEMBER', 'Course', courseId, { memberId: user.id });
  await loadCourses(); await loadManagerData(); renderAll(); renderCourseManagement();
  $('memberSearch').value = '';
  toast('Member added to course.', 'success');
}
async function addDepartmentMembersToCourse() {
  if (!isSuperAdmin()) return toast('Only Super Admin can bulk-add department members.', 'warn');
  const courseId = $('memberCourseSelect').value;
  const course = state.courses.find(c => c.id === courseId);
  if (!course) return toast('Select a course first.', 'warn');
  const deps = courseDepartments(course);
  const ids = unique(state.users.filter(u => deps.some(d => userBelongsToDepartment(u, d))).map(u => u.id));
  if (!ids.length) return toast('No users found in this course department.', 'warn');
  await updateDoc(doc(db, 'courses', courseId), { memberIds: arrayUnion(...ids), updatedAt: serverTimestamp() });
  await audit('ADD_DEPARTMENT_MEMBERS', 'Course', courseId, { departments: deps, count: ids.length });
  await loadCourses(); await loadManagerData(); renderAll();
  toast(`${ids.length} department members added to this course.`, 'success');
}
async function removeCourseMember(courseId, userId) {
  await updateDoc(doc(db, 'courses', courseId), { memberIds: arrayRemove(userId), updatedAt: serverTimestamp() });
  await audit('REMOVE_COURSE_MEMBER', 'Course', courseId, { memberId: userId });
  await loadCourses(); await loadManagerData(); renderAll(); renderCourseManagement();
}
async function approveCourseRequest(requestId, courseId, userId) {
  await updateDoc(doc(db, 'courses', courseId), { memberIds: arrayUnion(userId), updatedAt: serverTimestamp() });
  await updateDoc(doc(db, 'courseRequests', requestId), { status: 'Approved', reviewedAt: serverTimestamp(), reviewedBy: state.user.email });
  await audit('APPROVE_COURSE_REQUEST', 'Course', courseId, { requestId, userId });
  await loadCourses(); await loadManagerData(); renderAll(); renderCourseManagement();
}
async function rejectCourseRequest(requestId) {
  await updateDoc(doc(db, 'courseRequests', requestId), { status: 'Rejected', reviewedAt: serverTimestamp(), reviewedBy: state.user.email });
  await audit('REJECT_COURSE_REQUEST', 'CourseRequest', requestId);
  await loadManagerData(); renderCourseManagement();
}
function bindEvents() {
  $('googleLoginBtn').addEventListener('click', loginWithGoogle);
  $('logoutBtn').addEventListener('click', () => signOut(auth));
  $('reloadBtn').addEventListener('click', () => handleAuthUser(auth.currentUser));
  qsa('.nav button[data-page]').forEach(b => b.addEventListener('click', () => showPage(b.dataset.page)));
  qsa('[data-go]').forEach(b => b.addEventListener('click', () => showPage(b.dataset.go)));
  $('refreshCoursesBtn').addEventListener('click', async()=>{ await loadAttendance(); await loadCourses(); await loadManagerData(); renderAll(); });
  $('loadAttendanceBtn').addEventListener('click', renderAttendance);
  ['attendanceProfession','attendanceCourse'].forEach(id => { const el = $(id); if (el) el.addEventListener('input', renderAttendance); });
  $('exportCsvBtn').addEventListener('click', exportCsv);
  $('exportDocsBtn').addEventListener('click', exportDocs);
  $('startAttendanceAuditBtn')?.addEventListener('click', startAttendanceAudit);
  $('stopAttendanceAuditBtn')?.addEventListener('click', () => stopAttendanceAudit('Live attendance audit stopped.', true));
  $('saveProfileBtn').addEventListener('click', saveProfile);
  $('clearSignatureBtn').addEventListener('click', clearSignature);
  $('saveCourseBtn').addEventListener('click', saveCourse);
  $('uploadCourseFilesBtn').addEventListener('click', uploadCourseFiles);
  $('memberCourseSelect').addEventListener('change', renderMembersList);
  $('requestCourseSelect').addEventListener('change', renderRequestsList);
  $('addMemberBtn').addEventListener('click', addCourseMember);
  $('addDepartmentMembersBtn').addEventListener('click', addDepartmentMembersToCourse);
  $('adminUserSelect').addEventListener('change', syncRoleEditor);
  $('saveUserRoleBtn').addEventListener('click', saveUserRoleAccess);
  if ($('themeToggleBtn')) $('themeToggleBtn').addEventListener('click', toggleTheme);
  $('addQuestionBtn').addEventListener('click', () => addQuestionEditor());
  $('closeCourseModalBtn').addEventListener('click', closeCourseModal);
  $('openMainContentBtn').addEventListener('click', openMainContent);
  $('submitCourseBtn').addEventListener('click', submitCourse);
  $('saveLocalSettingsBtn').addEventListener('click', saveLocalSettings);
  window.addEventListener('error', e => logClient('window.error', e.message, {file:e.filename,line:e.lineno}));
  window.addEventListener('message', handleUploadMessage);
}

applyTheme('light');
bindEvents();
$('appsScriptUrl').value = window.CARELEARN_APPS_SCRIPT_EXPORT_URL || localStorage.getItem('carelearn.appsScriptUrl') || DEFAULT_APPS_SCRIPT_EXPORT_URL || '';
if ($('certificateScriptUrl')) $('certificateScriptUrl').value = window.CARELEARN_CERTIFICATE_WEBAPP_URL || localStorage.getItem('carelearn.certificateScriptUrl') || DEFAULT_CERTIFICATE_GENERATOR_URL || '';
getRedirectResult(auth).catch(e => console.warn(e));
onAuthStateChanged(auth, handleAuthUser);
