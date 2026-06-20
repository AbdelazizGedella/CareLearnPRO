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
if (!FIREBASE_CONFIG?.apiKey) {
  throw new Error('Missing Firebase config. Copy public/firebase-config.example.js to public/firebase-config.js and fill your Firebase web config.');
}

const DEFAULT_DEPARTMENTS = [
  'Housekeeping & Maintenance','Nursing Services Dir. Office Dept.','Patient Services Director Office','Laboratory Department','Jiwar-Hr','Quality Improvement Dept.','Er Pharmacy-Alharam','Respiratory Therapy','Operation Services Director Office','Emergency Department','Director General Office','Safety & Secuity','Supply Chain','Medical Services Dir. Office','Jiwar-Icu','Radoiology Department','Jiwar-Finance & Accounting','It Department','Physical Therapy','Jiwar-Nursing Icu'
];
const DEFAULT_PROFESSIONS = [
  'Housekeeper','Staff Nurses - Primary','Social Worker','Laboratory Head','Staff Nurses - ER','Laboratory Specialist','Executive Secretary','HR Coordinator','Medical Approval Coordinator','Quality & Patient Safety specialist','HR Officer','Medical records specialist','Receptionist','Pharmacist','Respiratory Therapy Specialist','Driver','General Practitioner','Security Guard','Senior Registrar ER Physician','Infection Control Specialist','Staff Nurse','Nursing Supervisor','Registrar Anesthesia','Porter','Admin Director','Shift Supervisor','Duty Manager','Registrar ER Physician','Radiology Registrar','Clinical Nutritionist','Senior Registrar Orthopedic Surgeon','Encoder','Registrar Internal Medicine','Radiology Specialist','Supervisor','AC Technician','Electrician Technician','Plumber','Accountant','IT Helpdesk','Gas Technican','Physical Therapist','Consultant Critical Care Medicine','Head Ambulatory & Emergency Care/ Senior Registrar ER physician','Registrar ICU','Registrar Cardiology'
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
  attendance: [],
  users: [],
  courseRequests: [],
  activePage: 'dashboard',
  currentCourse: null,
  activeSeconds: 0,
  timer: null,
  startedAt: null,
  signatureDirty: false,
  signatureHasInk: false,
  canvasReady: false,
  signatureCtx: null,
  drawing: false,
  questionsDraft: []
};

const $ = (id) => document.getElementById(id);
const qsa = (sel) => Array.from(document.querySelectorAll(sel));
const adminRoles = ['SuperAdmin','Admin','TrainingAdmin'];
const rolesCanManage = ['SuperAdmin','Admin','TrainingAdmin','Manager','DepartmentHead','CourseBuilder','Head','CourseManager'];
const rolesCanReport = ['SuperAdmin','Admin','TrainingAdmin','Manager','DepartmentHead','CourseBuilder','Head','CourseManager'];
const roleLabels = { CourseManager: 'Course Manager' };

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
function isManager() { return state.profile && rolesCanReport.includes(state.profile.role); }
function canManageCourses() { return state.profile && rolesCanManage.includes(state.profile.role); }
function isSuperAdmin() { return state.profile?.role === 'SuperAdmin'; }
function isAdminRole() { return state.profile && adminRoles.includes(state.profile.role); }
function canManageDepartment(dep) {
  if (!state.profile) return false;
  if (isAdminRole()) return true;
  return (state.profile.departments || []).includes(dep);
}
function permittedDepartments() {
  if (!state.profile) return [];
  if (isAdminRole()) return DEFAULT_DEPARTMENTS;
  return state.profile.departments || [];
}
function userBelongsToDepartment(user, department) {
  return user?.primaryDepartment === department || (user?.departments || []).includes(department);
}
function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}
function courseDepartments(course) {
  return unique([...(course?.departments || []), course?.department]);
}
function selectedCourseDepartments() {
  return qsa('#courseDepartment option').filter(o => o.selected).map(o => o.value);
}
function userDepartmentSet(user=state.profile) {
  return unique([...(user?.departments || []), user?.primaryDepartment]);
}
function intersects(a, b) {
  return a.some(x => b.includes(x));
}
function canManageCourse(course) {
  if (!state.profile || !course) return false;
  if (isAdminRole()) return true;
  if (state.profile.role === 'CourseManager') return course.managerUid === state.user?.uid || course.createdBy === state.user?.email;
  return course.managerUid === state.user?.uid || courseDepartments(course).some(canManageDepartment);
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
  if (state.profile?.role === 'CourseManager') {
    const ownSnap = await getDocs(query(collection(db, 'courses'), where('managerUid', '==', state.user.uid)));
    const merged = new Map(raw.map(c => [c.id, c]));
    ownSnap.docs.forEach(d => merged.set(d.id, { id: d.id, ...d.data() }));
    const legacySnap = await getDocs(query(collection(db, 'courses'), where('createdBy', '==', state.user.email)));
    legacySnap.docs.forEach(d => merged.set(d.id, { id: d.id, ...d.data() }));
    raw = Array.from(merged.values());
  }
  const userDeps = state.profile.departments || [];
  state.courses = raw
    .filter(c => isAdminRole() || c.managerUid === state.user.uid || (c.memberIds || []).includes(state.user.uid) || c.department === 'All' || intersects(courseDepartments(c), userDeps))
    .map(course => {
      const cycle = currentCycle(course);
      const attendanceId = `${state.user.uid}_${course.id}_${cycle}`;
      const completedRec = state.attendance.find(a => a.id === attendanceId || (a.courseId === course.id && (course.cycle === 'One Time' || a.cycle === cycle)));
      const availableFrom = toDate(course.createdAt) || new Date();
      const firstLogin = toDate(state.profile.firstLoginAt) || new Date();
      const effectiveStart = availableFrom > firstLogin ? availableFrom : firstLogin;
      const daysAvailable = Math.floor((new Date() - effectiveStart) / 86400000);
      const opened = course.lastOpenedAt || false;
      return { ...course, cycleKey: cycle, completed: !!completedRec, completedRecord: completedRec || null, isDue: course.status === 'Active' && isCourseMember(course) && !completedRec && !opened && daysAvailable > 7, dueDays: daysAvailable };
    });
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
  $('miniRole').textContent = `${roleLabels[state.profile.role] || state.profile.role || 'User'} | ${(state.profile.departments || []).join(', ') || 'No department'}`;
  $('adminNav').classList.toggle('hidden', !canManageCourses());
  $('profileAlert').classList.toggle('hidden', !!state.profile.profileCompleted);
}
function fillSelects() {
  const depOptions = ['<option value="">Select department</option>'].concat(DEFAULT_DEPARTMENTS.map(d => `<option>${escapeHtml(d)}</option>`)).join('');
  $('profileDepartment').innerHTML = depOptions;
  const courseDeps = permittedDepartments();
  $('courseDepartment').innerHTML = courseDeps.map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('') || depOptions;
  $('attendanceDepartment').innerHTML = '<option value="">All permitted departments</option>' + permittedDepartments().map(d => `<option>${escapeHtml(d)}</option>`).join('');
  $('profileProfession').innerHTML = '<option value="">Select profession</option>' + DEFAULT_PROFESSIONS.map(p => `<option>${escapeHtml(p)}</option>`).join('');
  $('attendanceCourse').innerHTML = '<option value="">All courses</option>' + state.courses.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.courseName)}</option>`).join('');
}
function renderAll() { renderDashboard(); renderCourses(); renderAttendance(); fillProfileForm(); renderCourseManagement(); renderRoleAdmin(); }
function renderDashboard() {
  const trackedCourses = state.courses.filter(c => c.status === 'Active' && isCourseMember(c));
  const assigned = trackedCourses.length;
  const completed = trackedCourses.filter(c => c.completed).length;
  const due = trackedCourses.filter(c => c.isDue).length;
  $('statAssigned').textContent = assigned;
  $('statCompleted').textContent = completed;
  $('statPending').textContent = Math.max(0, assigned - completed);
  $('statDue').textContent = due;
  $('statCoverage').textContent = assigned ? `${Math.round(completed / assigned * 100)}%` : '0%';
  $('dashboardCourses').innerHTML = buildCoursesBreakdownHtml(state.courses.slice(0, 10), true);
  const dueCourses = state.courses.filter(c => c.isDue);
  $('dueCoursesBox').innerHTML = dueCourses.length ? dueCourses.map(c => `<div class="alert warn"><strong>${escapeHtml(c.courseName)}</strong><br>${escapeHtml(c.department)} · ${c.dueDays} days</div>`).join('') : '<div class="empty">No due courses.</div>';
  renderManagerDashboard();
  bindOpenButtons();
}
function renderManagerDashboard() {
  const box = $('managerDashboardBox');
  if (!box) return;
  const managed = state.courses.filter(canManageCourse);
  box.classList.toggle('hidden', !managed.length);
  if (!managed.length) return;
  $('managerCoverageBody').innerHTML = managed.map(course => {
    const members = course.memberIds || [];
    const doneIds = new Set(state.attendance.filter(a => a.courseId === course.id && (course.cycle === 'One Time' || a.cycle === course.cycleKey)).map(a => a.userId));
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
function buildCoursesBreakdownHtml(courses, compact) {
  if (!courses.length) return '<div class="empty">No courses available yet.</div>';
  const rows = courses.map(c => `
      <tr>
        <td>${escapeHtml(c.courseName)}</td>
        <td>${escapeHtml(courseDepartments(c).join(', '))}</td>
        <td>Department</td>
        <td>${Number(c.requiredMinutes || 0)}m</td>
        <td>${escapeHtml(c.cycle || 'One Time')}</td>
        <td>${Number(c.passScore || 0)}%</td>
        <td><span class="status ${c.completed?'completed':c.isDue?'due':isCourseMember(c)?'pending':'locked'}">${c.completed?'Completed':c.isDue?'Due':isCourseMember(c)?'Pending':'Request Required'}</span></td>
        <td>${isCourseMember(c) ? `<button class="btn secondary open-course" data-id="${escapeHtml(c.id)}">${c.completed?'Review':'Open Course'}</button>` : `<button class="btn secondary request-course" data-id="${escapeHtml(c.id)}">Request Access</button>`}</td>
      </tr>`).join('');
  return `<div class="table-wrap compact-course-table"><table><thead><tr><th>Course</th><th>Department</th><th>Access</th><th>Time</th><th>Cycle</th><th>Pass</th><th>Status</th><th>Action</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
function renderAttendance() {
  const dep = $('attendanceDepartment')?.value || '';
  const courseId = $('attendanceCourse')?.value || '';
  const cycle = $('attendanceCycle')?.value.trim() || '';
  const search = ($('attendanceSearch')?.value || '').toLowerCase();
  let records = state.attendance.slice();
  if (dep) records = records.filter(r => r.department === dep);
  if (courseId) records = records.filter(r => r.courseId === courseId);
  if (cycle) records = records.filter(r => String(r.cycle || '') === cycle);
  if (search) records = records.filter(r => `${r.name} ${r.courseName}`.toLowerCase().includes(search));
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
  const titles = {dashboard:['Dashboard / لوحة التحكم','Welcome to your training workspace.'],courses:['Courses / الكورسات','Courses grouped by department.'],attendance:['Attendance / الحضور','Review and export attendance.'],profile:['Profile / الملف الشخصي','Update profile and e-signature.'],admin:['Admin / الإدارة','Build courses and settings.']};
  $('pageTitle').textContent = titles[page]?.[0] || titles.dashboard[0];
  $('pageSubtitle').textContent = titles[page]?.[1] || titles.dashboard[1];
  if (page === 'profile') setTimeout(initSignaturePad, 80);
  if (page === 'attendance') renderAttendance();
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
      departments: [$('profileDepartment').value].filter(Boolean),
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
    const id = $('courseId').value.trim() || crypto.randomUUID();
    const data = {
      courseName: $('courseName').value.trim(), department, departments,
      contentUrl: $('courseContentUrl').value.trim(),
      requiredMinutes: Number($('courseRequiredMinutes').value || 0),
      passScore: Number($('coursePassScore').value || 0),
      cycle: $('courseCycle').value, status: $('courseStatus').value,
      enrollmentMode: 'Department',
      brief: $('courseBrief').value.trim(), description: $('courseDescription').value.trim(),
      files: parseFilesText($('courseFiles').value), questions: readQuestionsBuilder(),
      updatedAt: serverTimestamp(), updatedBy: state.user.email
    };
    if (!data.courseName) throw new Error('Course Name is required.');
    const ref = doc(db, 'courses', id);
    const old = await getDoc(ref);
    if (old.exists()) await updateDoc(ref, { ...data, managerUid: old.data().managerUid || state.user.uid, managerEmail: old.data().managerEmail || state.user.email });
    else await setDoc(ref, { ...data, memberIds: [], managerUid: state.user.uid, managerEmail: state.user.email, createdAt: serverTimestamp(), createdBy: state.user.email });
    await audit(old.exists() ? 'UPDATE_COURSE' : 'CREATE_COURSE', 'Course', id);
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
  wrap.innerHTML = `<div class="form-grid"><label class="full">Question<input class="q-text" value="${escapeHtml(q.question||'')}"></label><label>Option A<input class="q-a" value="${escapeHtml(q.options?.A||'')}"></label><label>Option B<input class="q-b" value="${escapeHtml(q.options?.B||'')}"></label><label>Option C<input class="q-c" value="${escapeHtml(q.options?.C||'')}"></label><label>Option D<input class="q-d" value="${escapeHtml(q.options?.D||'')}"></label><label>Correct<select class="q-correct"><option>A</option><option>B</option><option>C</option><option>D</option></select></label><label>Rationale<input class="q-rationale" value="${escapeHtml(q.rationale||'')}"></label></div><button class="btn secondary remove-question" type="button">Remove</button>`;
  wrap.querySelector('.q-correct').value = q.correct || 'A';
  wrap.querySelector('.remove-question').addEventListener('click', () => wrap.remove());
  $('questionsBuilder').appendChild(wrap);
}

async function openCourse(id) {
  const course = state.courses.find(c => c.id === id);
  if (!course) return;
  if (!isCourseMember(course)) return toast('This course requires approval before you can open it.', 'warn');
  state.currentCourse = course;
  state.activeSeconds = 0;
  state.startedAt = new Date();
  $('modalCourseTitle').textContent = course.courseName;
  $('modalCourseMeta').textContent = `${course.department} · ${course.requiredMinutes || 0} min · Pass ${course.passScore || 0}% · ${course.cycle || 'One Time'}`;
  $('courseHero').innerHTML = `<h3>${escapeHtml(course.courseName)}</h3><p>${escapeHtml(course.brief || course.description || '')}</p>`;
  $('modalCourseDescription').textContent = course.description || '';
  $('completedNotice').classList.toggle('hidden', !course.completed);
  $('completedNotice').textContent = course.completed ? 'You have already completed this course. You can review the content, but attendance, score, signature, and duration will not change.' : '';
  $('submitCourseBtn').classList.toggle('hidden', !!course.completed);
  $('timerPanel').classList.toggle('hidden', !!course.completed);
  const primaryUrl = getPrimaryContentUrl(course);
  showContentInViewer(primaryUrl);
  $('courseFilesBox').innerHTML = (course.files || []).map(f => `<button class="file-link-btn" type="button" data-url="${escapeHtml(f.url)}">${escapeHtml(f.name)}</button>`).join('');
  qsa('.file-link-btn').forEach(btn => btn.addEventListener('click', () => showContentInViewer(btn.dataset.url)));
  renderQuiz(course.questions || []);
  $('courseModal').classList.remove('hidden');
  if (!course.completed) startTimer();
  await updateDoc(doc(db, 'courses', course.id), { lastOpenedAt: serverTimestamp() }).catch(()=>{});
  await audit(course.completed ? 'REVIEW_COURSE' : 'OPEN_COURSE', 'Course', course.id);
}
function closeCourseModal() { $('courseModal').classList.add('hidden'); stopTimer(); }
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
function renderQuiz(questions) {
  $('quizBox').innerHTML = questions.map((q, i) => `<div class="quiz-question"><strong>${i+1}. ${escapeHtml(q.question)}</strong>${['A','B','C','D'].map(k => q.options?.[k] ? `<label class="quiz-option"><input type="radio" name="q_${i}" value="${k}" data-index="${i}"> ${k}. ${escapeHtml(q.options[k])}</label>` : '').join('')}</div>`).join('');
}
function collectAnswers(questions) {
  const answers = {};
  questions.forEach((q, i) => { const checked = document.querySelector(`input[name="q_${i}"]:checked`); answers[i] = checked ? checked.value : ''; });
  return answers;
}
function scoreQuiz(questions, answers) {
  if (!questions.length) return 100;
  const correct = questions.filter((q, i) => (answers[i] || '') === q.correct).length;
  return Math.round(correct / questions.length * 100);
}
async function submitCourse() {
  const course = state.currentCourse;
  if (!course || course.completed) return;
  if (!isCourseMember(course)) return toast('This course requires approval before attendance can be recorded.', 'warn');
  const required = Number(course.requiredMinutes || 0) * 60;
  if (required && state.activeSeconds < required) return toast('Minimum required learning time has not been completed yet.', 'warn');
  const questions = course.questions || [];
  const answers = collectAnswers(questions);
  if (questions.length && Object.values(answers).filter(Boolean).length < questions.length) return toast('Please answer all MCQ questions.', 'warn');
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
    signatureDataUrl: state.profile.signatureDataUrl,
    completedAt: Timestamp.fromDate(completedAt), createdAt: serverTimestamp()
  };
  try {
    await setDoc(doc(db, 'attendance', attendanceId), rec);
    toast('Course completed successfully. Attendance recorded.', 'success');
    await audit('COURSE_COMPLETED', 'Course', course.id, { score });
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
  const dep = $('attendanceDepartment').value, courseId = $('attendanceCourse').value, cycle = $('attendanceCycle').value.trim(), s = $('attendanceSearch').value.toLowerCase();
  return state.attendance.filter(r => (!dep || r.department === dep) && (!courseId || r.courseId === courseId) && (!cycle || r.cycle === cycle) && (!s || `${r.name} ${r.courseName}`.toLowerCase().includes(s)));
}
async function exportDocs() {
  const url = localStorage.getItem('carelearn.appsScriptUrl') || $('appsScriptUrl').value.trim();
  if (!url) return toast('Add Apps Script Export Web App URL in Admin > Export Settings.', 'warn');
  const rows = filteredAttendance();
  if (!rows.length) return toast('No attendance records to export.', 'warn');
  const idToken = await state.user.getIdToken();
  const payload = {
    idToken,
    exportedBy: state.user.email,
    filters: { department: $('attendanceDepartment').value, courseId: $('attendanceCourse').value, cycle: $('attendanceCycle').value, search: $('attendanceSearch').value },
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
  const url = $('appsScriptUrl').value.trim();
  localStorage.setItem('carelearn.appsScriptUrl', url);
  toast('Export URL saved locally in this browser.', 'success');
}
function applyTheme(theme) {
  document.body.dataset.theme = theme;
  localStorage.setItem('carelearn.theme', theme);
  if ($('themeToggleBtn')) $('themeToggleBtn').textContent = theme === 'dark' ? 'Light Mode' : 'Dark Mode';
}
function toggleTheme() {
  applyTheme(document.body.dataset.theme === 'dark' ? 'light' : 'dark');
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
  const url = localStorage.getItem('carelearn.appsScriptUrl') || $('appsScriptUrl').value.trim();
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
  qsa('.open-course').forEach(btn => btn.addEventListener('click', () => openCourse(btn.dataset.id)));
  qsa('.request-course').forEach(btn => btn.addEventListener('click', () => requestCourseAccess(btn.dataset.id)));
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
  body.innerHTML = managed.length ? managed.map(c => `
    <tr>
      <td>${escapeHtml(c.courseName)}</td>
      <td>${escapeHtml(courseDepartments(c).join(', '))}</td>
      <td>${escapeHtml(c.cycle || 'Monthly')}</td>
      <td><span class="status ${c.status === 'Active' ? 'completed' : 'locked'}">${escapeHtml(c.status || 'Active')}</span></td>
      <td>${(c.memberIds || []).length}</td>
      <td><button class="btn secondary edit-course" data-id="${escapeHtml(c.id)}">Edit</button> <button class="btn secondary deactivate-course" data-id="${escapeHtml(c.id)}">Deactivate</button></td>
    </tr>`).join('') : '<tr><td colspan="6">No managed courses yet.</td></tr>';
  qsa('.edit-course').forEach(btn => btn.addEventListener('click', () => editCourse(btn.dataset.id)));
  qsa('.deactivate-course').forEach(btn => btn.addEventListener('click', () => deactivateCourse(btn.dataset.id)));
}
function editCourse(id) {
  const c = state.courses.find(x => x.id === id);
  if (!c) return;
  $('courseId').value = c.id;
  $('courseName').value = c.courseName || '';
  qsa('#courseDepartment option').forEach(opt => { opt.selected = courseDepartments(c).includes(opt.value); });
  $('courseContentUrl').value = c.contentUrl || '';
  $('courseRequiredMinutes').value = Number(c.requiredMinutes || 0);
  $('coursePassScore').value = Number(c.passScore || 0);
  $('courseCycle').value = c.cycle === 'Annual' ? 'Yearly' : (c.cycle || 'Monthly');
  $('courseStatus').value = c.status || 'Active';
  $('courseBrief').value = c.brief || '';
  $('courseDescription').value = c.description || '';
  $('courseFiles').value = (c.files || []).map(f => `${f.name || 'Course File'} | ${f.url}`).join('\n');
  $('questionsBuilder').innerHTML = '';
  (c.questions || []).forEach(addQuestionEditor);
  toast('Course loaded for editing.', 'success');
}
async function deactivateCourse(id) {
  const course = state.courses.find(c => c.id === id);
  if (!course || !canManageCourse(course)) return toast('You cannot manage this course.', 'error');
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
  $('adminUserSelect').innerHTML = state.users.map(u => `<option value="${escapeHtml(u.id)}">${escapeHtml(u.name || u.email || u.id)} - ${escapeHtml(roleLabels[u.role] || u.role || 'User')}</option>`).join('');
  $('adminDepartmentsSelect').innerHTML = DEFAULT_DEPARTMENTS.map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('');
  syncRoleEditor();
}
function syncRoleEditor() {
  if (!$('adminUserSelect')) return;
  const user = state.users.find(u => u.id === $('adminUserSelect').value) || state.users[0];
  if (!user) return;
  $('adminUserSelect').value = user.id;
  $('adminRoleSelect').value = user.role || 'User';
  const deps = user.departments || [];
  qsa('#adminDepartmentsSelect option').forEach(opt => { opt.selected = deps.includes(opt.value); });
}
async function saveUserRoleAccess() {
  const uid = $('adminUserSelect').value;
  const user = state.users.find(u => u.id === uid);
  if (!user) return toast('Select a user first.', 'warn');
  const departments = qsa('#adminDepartmentsSelect option').filter(o => o.selected).map(o => o.value);
  const role = $('adminRoleSelect').value;
  await updateDoc(doc(db, 'users', uid), {
    role,
    departments,
    primaryDepartment: departments[0] || user.primaryDepartment || '',
    updatedAt: serverTimestamp()
  });
  await audit('UPDATE_USER_ACCESS', 'User', uid, { role, departments });
  await loadManagerData();
  renderRoleAdmin();
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
  ['attendanceDepartment','attendanceCourse','attendanceCycle','attendanceSearch'].forEach(id => $(id).addEventListener('input', renderAttendance));
  $('exportCsvBtn').addEventListener('click', exportCsv);
  $('exportDocsBtn').addEventListener('click', exportDocs);
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
  $('themeToggleBtn').addEventListener('click', toggleTheme);
  $('addQuestionBtn').addEventListener('click', () => addQuestionEditor());
  $('closeCourseModalBtn').addEventListener('click', closeCourseModal);
  $('openMainContentBtn').addEventListener('click', openMainContent);
  $('submitCourseBtn').addEventListener('click', submitCourse);
  $('saveLocalSettingsBtn').addEventListener('click', saveLocalSettings);
  window.addEventListener('error', e => logClient('window.error', e.message, {file:e.filename,line:e.lineno}));
  window.addEventListener('message', handleUploadMessage);
}

applyTheme(localStorage.getItem('carelearn.theme') || 'light');
bindEvents();
$('appsScriptUrl').value = localStorage.getItem('carelearn.appsScriptUrl') || '';
getRedirectResult(auth).catch(e => console.warn(e));
onAuthStateChanged(auth, handleAuthUser);
