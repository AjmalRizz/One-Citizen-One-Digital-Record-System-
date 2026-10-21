/**
 * One Citizen One Digital Record (OCODR)
 * Core Frontend Application Logic & State Controller
 */

function getStoredUser() {
  try {
    const raw = localStorage.getItem('ocodr_user');
    return raw && raw !== 'undefined' && raw !== 'null' ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

// Global State
const state = {
  token: localStorage.getItem('ocodr_token') || null,
  user: getStoredUser(),
  currentCitizenId: 'LK-19900512-0042',
  inspectedCitizen: null,
  activeView: 'view-citizen-card',
  otpTimer: null,
  otpCountdown: 300, // 5 minutes in seconds
  temp2fa: null,
  auditPagination: { page: 1, limit: 15, total: 0, totalPages: 1 },
  adminRegistry: {
    sector: 'citizens',
    mode: 'VIEW', // 'VIEW' (Option 1) or 'DELETE' (Option 2)
    page: 1,
    limit: 15,
    total: 0,
    totalPages: 1,
    search: '',
    deleteTarget: null,
    activeRecord: null,
    currentRows: []
  },
  html5QrScanner: null
};

// Dynamic API Base URL:
// - When opened through Express directly (http://localhost:5000/): uses '/api'
// - When opened through VS Code Live Server (e.g. port 5500), Apache (e.g. port 8080), or file://:
//   automatically targets the backend on http://localhost:5000/api
const API_BASE = (() => {
  if (typeof window === 'undefined') return '/api';
  if (window.location.protocol.startsWith('http') && window.location.port === '5000') {
    return '/api';
  }
  const host = window.location.hostname || 'localhost';
  return `http://${host}:5000/api`;
})();

/**
 * Universal Authenticated API Request Wrapper
 */
async function apiRequest(endpoint, options = {}) {
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const url = endpoint.startsWith('http') ? endpoint : `${API_BASE}${cleanEndpoint}`;
  const headers = options.headers || {};

  if (state.token) {
    headers['Authorization'] = `Bearer ${state.token}`;
  }

  // Handle FormData vs JSON
  let body = options.body;
  if (body && !(body instanceof FormData) && typeof body === 'object') {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }

  try {
    const response = await fetch(url, {
      ...options,
      headers,
      body
    });

    const contentType = response.headers.get('content-type') || '';
    let data = {};

    if (contentType.includes('application/json')) {
      try {
        data = await response.json();
      } catch (jsonErr) {
        data = {};
      }
    } else {
      // Received non-JSON response (e.g. HTML 404 from Live Server or Apache)
      const rawText = await response.text().catch(() => '');
      if (rawText.trim().startsWith('<')) {
        const portHint = (typeof window !== 'undefined' && window.location.port && window.location.port !== '5000')
          ? ` You are accessing the portal on port ${window.location.port}. Please ensure the backend server is running ('npm start') on port 5000 and visit http://localhost:5000 directly.`
          : ` Please ensure the Node.js server is running ('npm start') on http://localhost:5000.`;
        throw new Error(`Server returned HTML instead of JSON (Status ${response.status}).${portHint}`);
      }
      try {
        data = JSON.parse(rawText);
      } catch (parseErr) {
        data = { message: rawText || `Unexpected response (${response.status})` };
      }
    }

    if (!response.ok) {
      if (response.status === 401 && typeof window !== 'undefined' && window.location.pathname.includes('dashboard')) {
        handleLogout();
        return { success: false, message: 'Session expired.' };
      }
      throw new Error(data.message || `Request failed with status ${response.status}`);
    }

    return data;
  } catch (error) {
    console.error(`API Error [${endpoint}]:`, error);
    if (error.name === 'TypeError' || (error.message && error.message.toLowerCase().includes('failed to fetch'))) {
      const netErr = new Error(`Cannot reach OCODR backend server at ${API_BASE}. Please ensure the Node.js server is running ('npm start' in terminal) on port 5000.`);
      netErr.isNetworkError = true;
      throw netErr;
    }
    throw error;
  }
}

/* ==========================================================================
   AUTHENTICATION & 2FA OTP MODAL LOGIC (INDEX.HTML)
   ========================================================================== */

function toggleAuthDropdown(dropdownId) {
  const target = document.getElementById(dropdownId);
  const isHidden = target ? target.classList.contains('hidden') : true;
  closeAllAuthDropdowns();
  if (target && isHidden) {
    target.classList.remove('hidden');
  }
}

function closeAllAuthDropdowns() {
  const ids = ['nav-reg-dropdown', 'nav-login-dropdown', 'hero-reg-dropdown', 'hero-login-dropdown'];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.auth-dropdown-container')) {
    closeAllAuthDropdowns();
  }
  const loginModal = document.getElementById('login-modal');
  if (e.target === loginModal) {
    closeLoginModal();
  }
  const registerModal = document.getElementById('register-modal');
  if (e.target === registerModal) {
    closeRegisterModal();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeAllAuthDropdowns();
    closeLoginModal();
    closeRegisterModal();
  }
});

function openLoginModal(category = 'CITIZEN') {
  closeAllAuthDropdowns();
  closeRegisterModal();
  const modal = document.getElementById('login-modal');
  if (modal) modal.classList.remove('hidden');
  setLoginCategory(category);
}

function setLoginCategory(category = 'CITIZEN') {
  const citBtn = document.getElementById('login-cat-citizen');
  const chdBtn = document.getElementById('login-cat-child');
  const othBtn = document.getElementById('login-cat-other');
  const uInput = document.getElementById('login-username');
  const pInput = document.getElementById('login-password');
  const desc = document.getElementById('login-category-desc');
  const titleEl = document.getElementById('login-modal-title');

  const activeCit = 'flex-1 py-1.5 rounded-lg bg-[#8D153A] text-white shadow-sm flex items-center justify-center gap-1.5 transition font-black';
  const activeChd = 'flex-1 py-1.5 rounded-lg bg-[#00534E] text-white shadow-sm flex items-center justify-center gap-1.5 transition font-black';
  const activeOth = 'flex-1 py-1.5 rounded-lg bg-indigo-700 text-white shadow-sm flex items-center justify-center gap-1.5 transition font-black';
  const inactive = 'flex-1 py-1.5 rounded-lg text-slate-600 hover:text-slate-900 flex items-center justify-center gap-1.5 transition font-black';

  if (uInput) uInput.removeAttribute('placeholder');
  if (pInput) pInput.removeAttribute('placeholder');

  if (category === 'CHILD') {
    if (chdBtn) chdBtn.className = activeChd;
    if (citBtn) citBtn.className = inactive;
    if (othBtn) othBtn.className = inactive;
    if (titleEl) titleEl.textContent = 'Child & Pupil Sign In';
    if (desc) desc.textContent = 'Sign in with your Child Digital Identity or Pupil Student Account.';
  } else if (category === 'OTHER') {
    if (othBtn) othBtn.className = activeOth;
    if (citBtn) citBtn.className = inactive;
    if (chdBtn) chdBtn.className = inactive;
    if (titleEl) titleEl.textContent = 'Official Department Sign In';
    if (desc) desc.textContent = 'Sign in with institutional department credentials (Hospital, School, Police, Admin, etc.).';
  } else {
    if (citBtn) citBtn.className = activeCit;
    if (chdBtn) chdBtn.className = inactive;
    if (othBtn) othBtn.className = inactive;
    if (titleEl) titleEl.textContent = 'Citizen Sign In';
    if (desc) desc.textContent = 'Sign in with your Sri Lankan National Citizen Account.';
  }
}

function closeLoginModal() {
  const modal = document.getElementById('login-modal');
  if (modal) modal.classList.add('hidden');
  backToCredentials();
}

function quickFill(username, email, password) {
  const uInput = document.getElementById('login-username');
  const eInput = document.getElementById('login-email');
  const pInput = document.getElementById('login-password');
  if (uInput) uInput.value = username;
  if (eInput && email) eInput.value = email;
  if (pInput) pInput.value = password;
}

function backToCredentials() {
  clearInterval(state.otpTimer);
  const step1 = document.getElementById('login-step-credentials');
  const step2 = document.getElementById('login-step-otp');
  if (step1) step1.classList.remove('hidden');
  if (step2) step2.classList.add('hidden');
  const err = document.getElementById('login-error-msg');
  if (err) err.classList.add('hidden');
}

function openRegisterModal(category = 'CITIZEN') {
  closeAllAuthDropdowns();
  closeLoginModal();
  userManuallyEditedSinhala = false;
  userManuallyEditedTamil = false;
  const modal = document.getElementById('register-modal');
  if (modal) modal.classList.remove('hidden');
  setRegistrationType(category);
  if (typeof updateTranslateBadges === 'function') updateTranslateBadges('idle');
  initNameAutoTranslation();
  const currentGender = document.getElementById('reg-gender')?.value || 'MALE';
  updateRegistrationFormPhoto(currentGender);
}

function setRegistrationType(type = 'CITIZEN') {
  const typeInput = document.getElementById('reg-type-input');
  if (typeInput) typeInput.value = type;

  const citBtn = document.getElementById('tab-reg-citizen');
  const chdBtn = document.getElementById('tab-reg-child');
  const parentsSection = document.getElementById('child-parents-section');
  const childInfoHeader = document.getElementById('child-info-header');
  const titleEl = document.getElementById('reg-modal-title');
  const descEl = document.getElementById('reg-modal-desc');
  const badgeEl = document.getElementById('reg-type-badge');
  const typeDesc = document.getElementById('reg-type-desc');
  const nicLabel = document.getElementById('reg-nic-label');
  const proceedBtn = document.getElementById('btn-register-proceed');

  // Dynamic labels for Citizen vs Child
  const firstNameLabel = document.getElementById('reg-first-name-label');
  const lastNameLabel = document.getElementById('reg-last-name-label');
  const dobLabel = document.getElementById('reg-dob-label');
  const genderLabel = document.getElementById('reg-gender-label');
  const addressLabel = document.getElementById('reg-address-label');
  const birthPlaceLabel = document.getElementById('reg-birth-place-label');
  const phoneLabel = document.getElementById('reg-phone-label');
  const emailLabel = document.getElementById('reg-email-label');

  const phoneInput = document.getElementById('reg-phone');
  const emailInput = document.getElementById('reg-email');

  const fName = document.getElementById('reg-father-name');
  const fNic = document.getElementById('reg-father-nic');
  const fPhone = document.getElementById('reg-father-phone');
  const mName = document.getElementById('reg-mother-name');
  const mNic = document.getElementById('reg-mother-nic');
  const mPhone = document.getElementById('reg-mother-phone');

  if (type === 'CHILD') {
    if (citBtn) citBtn.className = 'px-3 py-2.5 rounded-lg font-black text-xs flex items-center justify-center gap-2 border-2 transition shadow-sm bg-white text-slate-800 border-slate-300 hover:border-amber-400';
    if (chdBtn) chdBtn.className = 'px-3 py-2.5 rounded-lg font-black text-xs flex items-center justify-center gap-2 border-2 transition shadow-sm bg-[#00534E] text-white border-[#00534E]';
    if (parentsSection) parentsSection.classList.remove('hidden');
    if (childInfoHeader) childInfoHeader.classList.remove('hidden');
    if (titleEl) titleEl.textContent = 'Official Child & Minor Registration (Birth Record Integration)';
    if (descEl) descEl.textContent = "Democratic Socialist Republic of Sri Lanka - Registrar General's Vital Registry.";
    if (badgeEl) {
      badgeEl.className = 'text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-emerald-100 text-[#00534E] border border-emerald-300';
      badgeEl.textContent = 'Child & Birth Record Mode';
    }
    if (typeDesc) typeDesc.textContent = "Enrolling a child / minor pupil. Parents' information (Father & Mother) will be recorded like in a civil birth certificate.";
    if (nicLabel) nicLabel.innerHTML = 'Child Smart NIC / Pupil Registry ID (Optional for child / auto-generated)';
    if (proceedBtn) {
      const span = proceedBtn.querySelector('span');
      if (span) span.textContent = 'Proceed to 2FA Verification (Send OTP to Parent)';
    }

    // Dynamic Child-specific labels
    if (firstNameLabel) firstNameLabel.innerHTML = `Child's First Name <span class="text-rose-600">*</span>`;
    if (lastNameLabel) lastNameLabel.innerHTML = `Child's Last Name / Surname <span class="text-rose-600">*</span>`;
    if (dobLabel) dobLabel.innerHTML = `Child's Date of Birth <span class="text-rose-600">*</span>`;
    if (genderLabel) genderLabel.innerHTML = `Child's Gender <span class="text-rose-600">*</span>`;
    if (addressLabel) addressLabel.innerHTML = `Permanent Residence / Home Address <span class="text-rose-600">*</span>`;
    if (birthPlaceLabel) birthPlaceLabel.innerHTML = `Child's Place of Birth (Town/District) <span class="text-rose-600">*</span>`;
    if (phoneLabel) phoneLabel.innerHTML = `Parent / Guardian Contact Phone Number <span class="text-rose-600">*</span>`;
    if (emailLabel) emailLabel.innerHTML = `Parent / Guardian Email Address (for 2FA OTP) <span class="text-rose-600">*</span>`;
    if (phoneInput) phoneInput.removeAttribute('placeholder');
    if (emailInput) emailInput.removeAttribute('placeholder');

    if (fName) fName.required = true;
    if (fNic) fNic.required = true;
    if (fPhone) fPhone.required = true;
    if (mName) mName.required = true;
    if (mNic) mNic.required = true;
    if (mPhone) mPhone.required = true;

    // Auto-sync parent phone to contact phone
    const syncParentPhone = () => {
      if (typeInput.value === 'CHILD' && phoneInput && (!phoneInput.value || phoneInput.dataset.autoSynced === 'true')) {
        const val = fPhone?.value?.trim() || mPhone?.value?.trim();
        if (val) {
          phoneInput.value = val;
          phoneInput.dataset.autoSynced = 'true';
        }
      }
    };
    if (fPhone && !fPhone.dataset.syncBound) {
      fPhone.dataset.syncBound = 'true';
      fPhone.addEventListener('input', syncParentPhone);
    }
    if (mPhone && !mPhone.dataset.syncBound) {
      mPhone.dataset.syncBound = 'true';
      mPhone.addEventListener('input', syncParentPhone);
    }
    if (phoneInput && !phoneInput.dataset.editBound) {
      phoneInput.dataset.editBound = 'true';
      phoneInput.addEventListener('input', () => { phoneInput.dataset.autoSynced = 'false'; });
    }
  } else {
    if (citBtn) citBtn.className = 'px-3 py-2.5 rounded-lg font-black text-xs flex items-center justify-center gap-2 border-2 transition shadow-sm bg-[#8D153A] text-white border-[#8D153A]';
    if (chdBtn) chdBtn.className = 'px-3 py-2.5 rounded-lg font-black text-xs flex items-center justify-center gap-2 border-2 transition shadow-sm bg-white text-slate-800 border-slate-300 hover:border-amber-400';
    if (parentsSection) parentsSection.classList.add('hidden');
    if (childInfoHeader) childInfoHeader.classList.add('hidden');
    if (titleEl) titleEl.textContent = 'Official Citizen Enrollment';
    if (descEl) descEl.textContent = 'Democratic Socialist Republic of Sri Lanka National Digital Identity Core (OCODR).';
    if (badgeEl) {
      badgeEl.className = 'text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-rose-100 text-[#8D153A] border border-rose-300';
      badgeEl.textContent = 'Citizen Selected';
    }
    if (typeDesc) typeDesc.textContent = 'Standard civil enrollment for adult Sri Lankan citizens.';
    if (nicLabel) nicLabel.innerHTML = 'NIC Number (Optional for minor pupils)';
    if (proceedBtn) {
      const span = proceedBtn.querySelector('span');
      if (span) span.textContent = 'Proceed to 2FA Verification (Send OTP)';
    }

    // Dynamic Standard Citizen labels
    if (firstNameLabel) firstNameLabel.innerHTML = `First Name <span class="text-rose-600">*</span>`;
    if (lastNameLabel) lastNameLabel.innerHTML = `Last Name <span class="text-rose-600">*</span>`;
    if (dobLabel) dobLabel.innerHTML = `Date of Birth <span class="text-rose-600">*</span>`;
    if (genderLabel) genderLabel.innerHTML = `Gender <span class="text-rose-600">*</span>`;
    if (addressLabel) addressLabel.innerHTML = `Permanent Residence / Address (ස්ථිර ලිපිනය / நிரந்தர முகவரி) <span class="text-rose-600">*</span>`;
    if (birthPlaceLabel) birthPlaceLabel.innerHTML = `Place of Birth (උපන් ස්ථානය / பிறந்த இடம்) <span class="text-rose-600">*</span>`;
    if (phoneLabel) phoneLabel.innerHTML = `Phone Number <span class="text-rose-600">*</span>`;
    if (emailLabel) emailLabel.innerHTML = `Registered Real Email Address <span class="text-rose-600">*</span>`;
    if (phoneInput) phoneInput.removeAttribute('placeholder');
    if (emailInput) emailInput.removeAttribute('placeholder');

    if (fName) fName.required = false;
    if (fNic) fNic.required = false;
    if (fPhone) fPhone.required = false;
    if (mName) mName.required = false;
    if (mNic) mNic.required = false;
    if (mPhone) mPhone.required = false;
  }
}

function closeRegisterModal() {
  const modal = document.getElementById('register-modal');
  if (modal) modal.classList.add('hidden');
  const err = document.getElementById('register-error-msg');
  if (err) err.classList.add('hidden');
  const succ = document.getElementById('register-success-msg');
  if (succ) succ.classList.add('hidden');
}

// Comprehensive Client-side instant name dictionary for Sri Lankan names (0ms typing response)
const CLIENT_NAME_DICT = {
  // Islamic Sri Lankan Names
  'wasim': { si: 'වසීම්', ta: 'வசீம்' },
  'waseem': { si: 'වසීම්', ta: 'வசீம்' },
  'bari': { si: 'බාරි', ta: 'பாரி' },
  'ahmad': { si: 'අහ්මද්', ta: 'அஹ்மத்' },
  'ahmadh': { si: 'අහ්මද්', ta: 'அஹ்மத்' },
  'ahmed': { si: 'අහ්මඩ්', ta: 'அஹ்மத்' },
  'bilaal': { si: 'බිලාල්', ta: 'பிலால்' },
  'bilal': { si: 'බිලාල්', ta: 'பிலால்' },
  'yumna': { si: 'යුම්නා', ta: 'யும்னா' },
  'fathima': { si: 'ෆාතිමා', ta: 'பாத்திமா' },
  'fatima': { si: 'ෆාතිමා', ta: 'பாத்திමා' },
  'mohamed': { si: 'මොහොමඩ්', ta: 'முகமது' },
  'mohammed': { si: 'මොහොමඩ්', ta: 'முகமது' },
  'muhammad': { si: 'මුහම්මද්', ta: 'முஹம்மது' },
  'rizwan': { si: 'රිස්වාන්', ta: 'ரிஸ்வான்' },
  'raaid': { si: 'රායිඩ්', ta: 'ராயித்' },
  'hana': { si: 'හනා', ta: 'ஹனா' },
  'hilmy': { si: 'හිල්මි', ta: 'ஹில்மி' },
  'fazil': { si: 'ෆාසිල්', ta: 'பாசில்' },
  'farhan': { si: 'ෆර්හාන්', ta: 'பர்ஹான்' },
  'aslam': { si: 'අස්ලම්', ta: 'அஸ்லம்' },
  'imran': { si: 'ඉම්රාන්', ta: 'இம்ரான்' },
  'nabeel': { si: 'නබීල්', ta: 'நபீல்' },
  'zackariya': { si: 'සකරියා', ta: 'சக்கரியா' },
  'aisha': { si: 'අයිෂා', ta: 'ஆயிஷா' },
  'mariyam': { si: 'මරියම්', ta: 'மரியම්' },
  'zainab': { si: 'සයිනබ්', ta: 'ஜைනப்' },

  // Sinhalese Names
  'malith': { si: 'මලිත්', ta: 'மலித்' },
  'kasun': { si: 'කසුන්', ta: 'கசுன்' },
  'perera': { si: 'පෙරේරා', ta: 'பெரேரா' },
  'silva': { si: 'සිල්වා', ta: 'சில்வா' },
  'fernando': { si: 'ප්‍රනාන්දු', ta: 'பெர்னாண்டோ' },
  'dissanayake': { si: 'දිසානායක', ta: 'திஸாநாயக்க' },
  'dissanayaka': { si: 'දිසානායක', ta: 'திஸாநாயக்க' },
  'bandara': { si: 'බණ්ඩාර', ta: 'பண்டார' },
  'senanayake': { si: 'සේනානායක', ta: 'சேனாநாயக்க' },
  'jayawardena': { si: 'ජයවර්ධන', ta: 'ஜயவர்தன' },
  'jayawardene': { si: 'ජයවර්ධන', ta: 'ஜயவர்தன' },
  'rajapaksa': { si: 'රාජපක්ෂ', ta: 'ராஜபக்ஷ' },
  'wickramasinghe': { si: 'වික්‍රමසිංහ', ta: 'விக்ரமசிங்க' },
  'kavindu': { si: 'කවිඳු', ta: 'கவிந்து' },
  'chaminda': { si: 'චමින්ද', ta: 'சமிந்த' },
  'nuwan': { si: 'නුවන්', ta: 'நுவன்' },
  'saman': { si: 'සමන්', ta: 'சமன்' },
  'sunil': { si: 'සුනිල්', ta: 'சுனில்' },
  'ruwan': { si: 'රුවන්', ta: 'ருவன்' },
  'anura': { si: 'අනුර', ta: 'அனுர' },
  'kamal': { si: 'කමල්', ta: 'கமல்' },
  'nimal': { si: 'නිමල්', ta: 'நிமல்' },
  'kumara': { si: 'කුමාර', ta: 'குமார' },
  'kushani': { si: 'කුෂානි', ta: 'குஷானி' },
  'nadeesha': { si: 'නදීෂා', ta: 'நதீஷா' },
  'dilshan': { si: 'දිල්ෂාන්', ta: 'தில்ஷான்' },
  'lahiru': { si: 'ලහිරු', ta: 'லகிரு' },
  'pradeep': { si: 'ප්‍රදීප්', ta: 'பிரதீப்' },
  'saputhanthri': { si: 'සපුතන්ත්‍රී', ta: 'சபுதந்த்ரி' },

  // Tamil Names
  'kumar': { si: 'කුමාර්', ta: 'குமார்' },
  'selvam': { si: 'සෙල්වම්', ta: 'செல்வம்' },
  'rajan': { si: 'රාජන්', ta: 'ராஜன்' },
  'suresh': { si: 'සුරේෂ්', ta: 'சுரேஷ்' },
  'vijay': { si: 'විජය', ta: 'விஜய்' },
  'shankar': { si: 'ශංකර්', ta: 'சங்கர்' },
  'priya': { si: 'ප්‍රියා', ta: 'பிரியா' },
  'shanthi': { si: 'ශාන්ති', ta: 'சாந்தி' },
  'lakshmi': { si: 'ලක්ෂ්මි', ta: 'லட்சுமி' },
  'muthu': { si: 'මුතු', ta: 'முத்து' },
  'sivakumar': { si: 'සිවකුමාර්', ta: 'சிவகுமார்' },
  'kanesan': { si: 'ගනේෂන්', ta: 'கணேசன்' },
  'murugan': { si: 'මුරුගන්', ta: 'முருகன்' },
  'lingam': { si: 'ලිංගම්', ta: 'லிங்கம்' }
};

// Client-side Phonetic Transliteration Rules (0ms offline fallback for arbitrary names)
function clientPhoneticSinhala(word) {
  if (!word) return '';
  const w = word.toLowerCase();
  if (CLIENT_NAME_DICT[w]) return CLIENT_NAME_DICT[w].si;

  const map = [
    { en: 'sh', si: 'ෂ' },
    { en: 'th', si: 'ත්' },
    { en: 'ch', si: 'ච' },
    { en: 'dh', si: 'ද්' },
    { en: 'ph', si: 'ෆ' },
    { en: 'kh', si: 'ඛ' },
    { en: 'gh', si: 'ඝ' },
    { en: 'aa', si: 'ආ' },
    { en: 'ee', si: 'ඊ' },
    { en: 'oo', si: 'ඌ' },
    { en: 'ai', si: 'අයි' },
    { en: 'au', si: 'ඖ' },
    { en: 'a', si: 'අ' },
    { en: 'b', si: 'බ' },
    { en: 'c', si: 'ක' },
    { en: 'd', si: 'ද' },
    { en: 'e', si: 'එ' },
    { en: 'f', si: 'ෆ' },
    { en: 'g', si: 'ග' },
    { en: 'h', si: 'හ' },
    { en: 'i', si: 'ඉ' },
    { en: 'j', si: 'ජ' },
    { en: 'k', si: 'ක' },
    { en: 'l', si: 'ල' },
    { en: 'm', si: 'ම' },
    { en: 'n', si: 'න' },
    { en: 'o', si: 'ඔ' },
    { en: 'p', si: 'ප' },
    { en: 'q', si: 'ක' },
    { en: 'r', si: 'ර' },
    { en: 's', si: 'ස' },
    { en: 't', si: 'ත' },
    { en: 'u', si: 'උ' },
    { en: 'v', si: 'ව' },
    { en: 'w', si: 'ව' },
    { en: 'x', si: 'ක්ස්' },
    { en: 'y', si: 'ය' },
    { en: 'z', si: 'ස්' }
  ];

  let res = '';
  let i = 0;
  while (i < w.length) {
    let matched = false;
    for (const rule of map) {
      if (w.slice(i, i + rule.en.length) === rule.en) {
        res += rule.si;
        i += rule.en.length;
        matched = true;
        break;
      }
    }
    if (!matched) {
      res += w[i];
      i++;
    }
  }
  return res;
}

function clientPhoneticTamil(word) {
  if (!word) return '';
  const w = word.toLowerCase();
  if (CLIENT_NAME_DICT[w]) return CLIENT_NAME_DICT[w].ta;

  const map = [
    { en: 'sh', ta: 'ஷ' },
    { en: 'th', ta: 'த' },
    { en: 'ch', ta: 'ச' },
    { en: 'dh', ta: 'த' },
    { en: 'ph', ta: 'ப' },
    { en: 'kh', ta: 'க' },
    { en: 'gh', ta: 'க' },
    { en: 'aa', ta: 'ஆ' },
    { en: 'ee', ta: 'ஈ' },
    { en: 'oo', ta: 'ஊ' },
    { en: 'ai', ta: 'ஐ' },
    { en: 'au', ta: 'ஔ' },
    { en: 'a', ta: 'அ' },
    { en: 'b', ta: 'ப' },
    { en: 'c', ta: 'க' },
    { en: 'd', ta: 'ட' },
    { en: 'e', ta: 'எ' },
    { en: 'f', ta: 'ப' },
    { en: 'g', ta: 'க' },
    { en: 'h', ta: 'ஹ' },
    { en: 'i', ta: 'இ' },
    { en: 'j', ta: 'ஜ' },
    { en: 'k', ta: 'க' },
    { en: 'l', ta: 'ல' },
    { en: 'm', ta: 'ம' },
    { en: 'n', ta: 'ந' },
    { en: 'o', ta: 'ஒ' },
    { en: 'p', ta: 'ப' },
    { en: 'q', ta: 'க' },
    { en: 'r', ta: 'ர' },
    { en: 's', ta: 'ச' },
    { en: 't', ta: 'த' },
    { en: 'u', ta: 'உ' },
    { en: 'v', ta: 'வ' },
    { en: 'w', ta: 'வ' },
    { en: 'x', ta: 'க்ස්' },
    { en: 'y', ta: 'ய' },
    { en: 'z', ta: 'ஸ' }
  ];

  let res = '';
  let i = 0;
  while (i < w.length) {
    let matched = false;
    for (const rule of map) {
      if (w.slice(i, i + rule.en.length) === rule.en) {
        res += rule.ta;
        i += rule.en.length;
        matched = true;
        break;
      }
    }
    if (!matched) {
      res += w[i];
      i++;
    }
  }
  return res;
}

let autoTranslateDebounceTimer = null;
let userManuallyEditedSinhala = false;
let userManuallyEditedTamil = false;

function updateTranslateBadges(status) {
  const siTxt = document.getElementById('badge-translate-si-txt');
  const taTxt = document.getElementById('badge-translate-ta-txt');

  if (status === 'translating') {
    if (siTxt) siTxt.textContent = 'Translating...';
    if (taTxt) taTxt.textContent = 'Translating...';
  } else if (status === 'success') {
    if (siTxt) siTxt.textContent = 'Auto-translated';
    if (taTxt) taTxt.textContent = 'Auto-translated';
  } else if (status === 'manual') {
    if (userManuallyEditedSinhala && siTxt) siTxt.textContent = 'Manual (re-translate)';
    if (userManuallyEditedTamil && taTxt) taTxt.textContent = 'Manual (re-translate)';
  } else {
    if (siTxt) siTxt.textContent = 'Auto-translates';
    if (taTxt) taTxt.textContent = 'Auto-translates';
  }
}

function forceRetranslate() {
  userManuallyEditedSinhala = false;
  userManuallyEditedTamil = false;
  updateTranslateBadges('idle');
  handleAutoTranslateName();
}

function initNameAutoTranslation() {
  const firstNameInput = document.getElementById('reg-first-name');
  const middleNamesInput = document.getElementById('reg-middle-names');
  const lastNameInput = document.getElementById('reg-last-name');
  const nameSiInput = document.getElementById('reg-name-si');
  const nameTaInput = document.getElementById('reg-name-ta');

  if (!firstNameInput || !lastNameInput || !nameSiInput || !nameTaInput) return;

  // Prevent duplicate event listener bindings
  if (firstNameInput.dataset.translateBound === 'true') return;
  firstNameInput.dataset.translateBound = 'true';

  nameSiInput.addEventListener('input', () => {
    userManuallyEditedSinhala = !!nameSiInput.value.trim();
    updateTranslateBadges(userManuallyEditedSinhala ? 'manual' : 'idle');
  });
  nameTaInput.addEventListener('input', () => {
    userManuallyEditedTamil = !!nameTaInput.value.trim();
    updateTranslateBadges(userManuallyEditedTamil ? 'manual' : 'idle');
  });

  const onNameChange = () => {
    // 1. Instant 0ms local transliteration feedback
    handleAutoTranslateLocal();

    // 2. Debounced high-precision server / Google transliteration
    clearTimeout(autoTranslateDebounceTimer);
    autoTranslateDebounceTimer = setTimeout(() => {
      handleAutoTranslateRemote();
    }, 250);
  };

  ['input', 'keyup', 'change', 'paste'].forEach(evt => {
    firstNameInput.addEventListener(evt, onNameChange);
    if (middleNamesInput) middleNamesInput.addEventListener(evt, onNameChange);
    lastNameInput.addEventListener(evt, onNameChange);
  });
}

function getRegistrationFullName() {
  const first = document.getElementById('reg-first-name')?.value.trim() || '';
  const middle = document.getElementById('reg-middle-names')?.value.trim() || '';
  const last = document.getElementById('reg-last-name')?.value.trim() || '';
  return [first, middle, last].filter(Boolean).join(' ');
}

// 0ms instant local transliteration for immediate typing feedback
function handleAutoTranslateLocal() {
  const fullName = getRegistrationFullName();
  const nameSiInput = document.getElementById('reg-name-si');
  const nameTaInput = document.getElementById('reg-name-ta');

  if (!fullName) {
    if (!userManuallyEditedSinhala && nameSiInput) nameSiInput.value = '';
    if (!userManuallyEditedTamil && nameTaInput) nameTaInput.value = '';
    updateTranslateBadges('idle');
    return;
  }

  const words = fullName.split(/s+/).filter(Boolean);
  const quickSi = [];
  const quickTa = [];

  words.forEach(w => {
    const clean = w.replace(/[^a-zA-Z]/g, '').toLowerCase();
    if (!clean) return;
    if (CLIENT_NAME_DICT[clean]) {
      quickSi.push(CLIENT_NAME_DICT[clean].si);
      quickTa.push(CLIENT_NAME_DICT[clean].ta);
    } else {
      quickSi.push(clientPhoneticSinhala(clean));
      quickTa.push(clientPhoneticTamil(clean));
    }
  });

  if (quickSi.length > 0) {
    if (!userManuallyEditedSinhala && nameSiInput) {
      nameSiInput.value = quickSi.join(' ');
    }
    if (!userManuallyEditedTamil && nameTaInput) {
      nameTaInput.value = quickTa.join(' ');
    }
    updateTranslateBadges('translating');
  }
}

// High-precision remote translation / Google Input Tools via backend
async function handleAutoTranslateRemote() {
  const fullName = getRegistrationFullName();
  const nameSiInput = document.getElementById('reg-name-si');
  const nameTaInput = document.getElementById('reg-name-ta');

  if (!fullName) return;

  try {
    const data = await apiRequest(`/translate/name?name=${encodeURIComponent(fullName)}`);
    if (data && data.success) {
      if (!userManuallyEditedSinhala && nameSiInput && data.sinhala) {
        nameSiInput.value = data.sinhala;
      }
      if (!userManuallyEditedTamil && nameTaInput && data.tamil) {
        nameTaInput.value = data.tamil;
      }
      updateTranslateBadges('success');
    }
  } catch (err) {
    console.warn('[Auto-translate network error]', err.message || err);
    updateTranslateBadges('idle');
  }
}

function handleAutoTranslateName() {
  handleAutoTranslateLocal();
  handleAutoTranslateRemote();
}

let pendingRegistration = null;
let regCountdownTimer = null;

function showRegisterError(msg) {
  const errDiv = document.getElementById('register-error-msg');
  if (errDiv) {
    const isConnErr = msg && (msg.toLowerCase().includes('cannot reach') || msg.toLowerCase().includes('failed to fetch') || msg.toLowerCase().includes('network'));
    errDiv.innerHTML = `
      <div class="flex items-start gap-2.5">
        <i class="fa-solid fa-triangle-exclamation text-rose-600 text-sm mt-0.5 shrink-0"></i>
        <div class="text-left flex-1">
          <span class="font-bold block">${msg}</span>
          ${isConnErr ? `
            <div class="mt-2 text-[11px] text-slate-700 font-medium bg-rose-100/60 p-2.5 rounded-lg border border-rose-300">
              <strong class="text-rose-900 block mb-0.5"><i class="fa-solid fa-circle-info"></i> Backend Server Offline</strong>
              Please ensure the Node.js API server is running on port 5000:
              <pre class="bg-slate-900 text-amber-300 px-2 py-1 rounded text-[10px] mt-1 font-mono select-all">npm start</pre>
              Then access the portal directly at <a href="http://localhost:5000" class="text-blue-800 underline font-bold">http://localhost:5000</a>.
            </div>
          ` : ''}
        </div>
      </div>
    `;
    errDiv.classList.remove('hidden');
    errDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

async function handleRegisterProceedToOtp(e) {
  e.preventDefault();
  const errDiv = document.getElementById('register-error-msg');
  if (errDiv) errDiv.classList.add('hidden');

  const firstName = document.getElementById('reg-first-name')?.value.trim();
  const lastName = document.getElementById('reg-last-name')?.value.trim();
  const middleNames = document.getElementById('reg-middle-names')?.value.trim() || null;
  const nameSi = document.getElementById('reg-name-si')?.value.trim() || null;
  const nameTa = document.getElementById('reg-name-ta')?.value.trim() || null;
  const dob = document.getElementById('reg-dob')?.value;
  const gender = document.getElementById('reg-gender')?.value;
  const bloodGroup = document.getElementById('reg-blood-group')?.value;
  const permanentAddress = document.getElementById('reg-permanent-address')?.value.trim();
  const birthPlace = document.getElementById('reg-birth-place')?.value.trim();
  const nicNumber = document.getElementById('reg-nic')?.value.trim() || null;
  const phone = document.getElementById('reg-phone')?.value.trim();
  const email = document.getElementById('reg-email')?.value.trim();
  const username = document.getElementById('reg-username')?.value.trim();
  const password = document.getElementById('reg-password')?.value;
  const confirmPassword = document.getElementById('reg-confirm-password')?.value;

  const regType = document.getElementById('reg-type-input')?.value || 'CITIZEN';
  const isChild = regType === 'CHILD';

  const fatherName = document.getElementById('reg-father-name')?.value.trim() || null;
  const fatherNic = document.getElementById('reg-father-nic')?.value.trim() || null;
  const fatherPhone = document.getElementById('reg-father-phone')?.value.trim() || null;
  const motherName = document.getElementById('reg-mother-name')?.value.trim() || null;
  const motherNic = document.getElementById('reg-mother-nic')?.value.trim() || null;
  const motherPhone = document.getElementById('reg-mother-phone')?.value.trim() || null;
  const birthHospital = document.getElementById('reg-birth-hospital')?.value.trim() || null;
  const birthAttendant = document.getElementById('reg-birth-attendant')?.value.trim() || null;
  const birthInformant = document.getElementById('reg-birth-informant')?.value.trim() || null;
  const informantNic = document.getElementById('reg-informant-nic')?.value.trim() || null;
  const informantPhone = document.getElementById('reg-informant-phone')?.value.trim() || null;

  if (!permanentAddress) {
    showRegisterError('Permanent Residence address is mandatory and must be entered.');
    return;
  }

  if (password !== confirmPassword) {
    showRegisterError('Passwords do not match. Please verify and try again.');
    return;
  }

  // Child validation checks for parents details
  if (isChild) {
    if (!fatherName && !motherName) {
      showRegisterError("Please enter Father's or Mother's details as recorded on the Birth Certificate.");
      return;
    }
    if (fatherName && (!fatherNic || !fatherPhone)) {
      showRegisterError("Please enter both Father's NIC and Father's contact phone number.");
      return;
    }
    if (motherName && (!motherNic || !motherPhone)) {
      showRegisterError("Please enter both Mother's NIC and Mother's contact phone number.");
      return;
    }
  }

  const effectivePhone = phone || fatherPhone || motherPhone;

  pendingRegistration = {
    registration_type: regType,
    is_child: isChild,
    first_name: firstName,
    last_name: lastName,
    middle_names: middleNames,
    name_si: nameSi,
    name_ta: nameTa,
    date_of_birth: dob,
    gender,
    blood_group: bloodGroup,
    permanent_address: permanentAddress,
    birth_place: birthPlace,
    nic_number: nicNumber,
    phone_number: effectivePhone,
    email,
    username,
    password,
    father_name: fatherName,
    father_nic: fatherNic,
    father_phone: fatherPhone,
    mother_name: motherName,
    mother_nic: motherNic,
    mother_phone: motherPhone,
    hospital_name: birthHospital,
    attending_physician: birthAttendant,
    informant_name: birthInformant,
    informant_nic: informantNic,
    informant_phone: informantPhone
  };

  const btn = document.getElementById('btn-register-proceed');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Dispatching Verification Code...`;
  }

  try {
    const data = await apiRequest('/auth/send-otp', {
      method: 'POST',
      body: { identifier: email, phone_number: effectivePhone, purpose: 'REGISTER' }
    });

    if (!data.success) {
      throw new Error(data.message || 'Failed to dispatch verification code.');
    }

    // Switch view to Step 2 OTP
    document.getElementById('register-step-details').classList.add('hidden');
    document.getElementById('register-step-otp').classList.remove('hidden');

    const targetDisplay = document.getElementById('reg-otp-target-display');
    if (targetDisplay) targetDisplay.textContent = `${email} (${phone})`;

    const devHint = document.getElementById('reg-otp-dev-hint');
    if (devHint && data.dev_otp) {
      devHint.innerHTML = `
        <div class="p-3 bg-amber-50 border-2 border-amber-400 rounded-xl flex items-center justify-between gap-2 shadow-sm mb-3">
          <div class="flex items-center gap-2">
            <i class="fa-solid fa-envelope-circle-check text-amber-700 text-lg"></i>
            <div class="text-left">
              <span class="text-[10px] text-amber-900 font-extrabold uppercase tracking-wider block">Security OTP Code (Auto-filled):</span>
              <span class="font-mono font-black text-base text-[#8D153A] tracking-widest">${data.dev_otp}</span>
            </div>
          </div>
          <button type="button" onclick="quickFillRegOtp('${data.dev_otp}')" class="px-2.5 py-1 bg-[#8D153A] text-white text-xs font-bold rounded-lg hover:bg-[#6e0f2d] transition shadow-sm">
            <i class="fa-solid fa-arrow-down mr-1"></i> Auto-fill
          </button>
        </div>
        <p class="text-[10px] text-slate-500 mb-2 text-center">
          ${data.smtp_active ? 'Delivered via SMTP relay and auto-filled above.' : '⚡ Local development simulated delivery (SMTP not configured in .env).'}
        </p>
      `;
      devHint.classList.remove('hidden');
      quickFillRegOtp(data.dev_otp);
    }

    startRegOtpCountdown();
    setupRegOtpDigitInputs();

  } catch (error) {
    showRegisterError(error.message || 'Failed to send OTP code.');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<span>Proceed to 2FA Verification (Send OTP)</span> <i class="fa-solid fa-arrow-right text-xs text-amber-300"></i>`;
    }
  }
}

async function handleRegisterConfirmOtp(e) {
  e.preventDefault();
  const errDiv = document.getElementById('register-otp-error-msg');
  if (errDiv) errDiv.classList.add('hidden');

  const digitInputs = document.querySelectorAll('.reg-otp-digit');
  const code = Array.from(digitInputs).map(i => i.value.trim()).join('');

  if (code.length !== 6) {
    if (errDiv) {
      errDiv.textContent = 'Please enter the complete 6-digit verification code.';
      errDiv.classList.remove('hidden');
    }
    return;
  }

  const btn = document.getElementById('btn-register-confirm-otp');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Verifying Code & Saving Citizen Record...`;
  }

  try {
    const data = await apiRequest('/auth/register', {
      method: 'POST',
      body: {
        ...pendingRegistration,
        otp_code: code
      }
    });

    if (!data.success) {
      throw new Error(data.message || 'OTP verification failed. Data not saved.');
    }

    if (data.token) {
      localStorage.setItem('ocodr_token', data.token);
      localStorage.setItem('auth_token', data.token);
      state.token = data.token;
    }
    if (data.user) {
      localStorage.setItem('ocodr_user', JSON.stringify(data.user));
      localStorage.setItem('user', JSON.stringify(data.user));
      state.user = data.user;
    }

    document.getElementById('register-step-otp').classList.add('hidden');
    document.getElementById('register-step-success').classList.remove('hidden');

    const idSpan = document.getElementById('new-cit-id');
    if (idSpan) idSpan.textContent = data.citizen_id;
    const nicSpan = document.getElementById('new-cit-nic');
    if (nicSpan) nicSpan.textContent = data.nic_number;

    // Display Birth Certificate Registration Number if returned (e.g. for Child)
    const birthRow = document.getElementById('new-cit-birth-row');
    const birthSpan = document.getElementById('new-cit-birth-reg');
    const titleEl = document.getElementById('reg-success-title');
    const descEl = document.getElementById('reg-success-desc');

    if (data.birth_reg_number) {
      if (birthRow) birthRow.classList.remove('hidden');
      if (birthSpan) birthSpan.textContent = data.birth_reg_number;
      if (titleEl) titleEl.textContent = 'Child Record Successfully Registered!';
      if (descEl) descEl.textContent = 'Pupil Digital Identity (Smart NIC) and certified Birth Certificate record have been generated and secured in the national core registry.';
    } else {
      if (birthRow) birthRow.classList.add('hidden');
      if (titleEl) titleEl.textContent = 'Citizen Record Successfully Saved!';
      if (descEl) descEl.textContent = 'Your Sri Lankan National Digital Citizen Identity (Smart NIC) has been registered in the national core registry.';
    }

    showToast(data.is_child ? 'Child & birth record verified and saved!' : 'Citizen registration verified and saved!', 'success');

  } catch (error) {
    if (errDiv) {
      errDiv.textContent = error.message;
      errDiv.classList.remove('hidden');
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<i class="fa-solid fa-cloud-arrow-up text-amber-300"></i> Verify OTP & Save Citizen Record`;
    }
  }
}

function quickFillRegOtp(code) {
  const inputs = document.querySelectorAll('.reg-otp-digit');
  code.split('').forEach((char, idx) => {
    if (inputs[idx]) inputs[idx].value = char;
  });
  if (inputs[5]) inputs[5].focus();
}

function backToRegisterDetails() {
  document.getElementById('register-step-otp').classList.add('hidden');
  document.getElementById('register-step-details').classList.remove('hidden');
  if (regCountdownTimer) clearInterval(regCountdownTimer);
}

function resendRegisterOtp() {
  if (!pendingRegistration) return;
  apiRequest('/auth/send-otp', {
    method: 'POST',
    body: { identifier: pendingRegistration.email, phone_number: pendingRegistration.phone_number, purpose: 'REGISTER' }
  }).then(data => {
    if (data.success) {
      showToast('A new OTP has been dispatched.', 'success');
      startRegOtpCountdown();
      const devHint = document.getElementById('reg-otp-dev-hint');
      if (devHint && data.dev_otp) {
        devHint.innerHTML = `
          <span class="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-100 border border-amber-300 rounded-lg text-amber-950 font-bold text-xs cursor-pointer hover:bg-amber-200 transition" onclick="quickFillRegOtp('${data.dev_otp}')">
            <i class="fa-solid fa-key text-amber-700"></i> Test OTP: <strong class="font-mono text-sm underline">${data.dev_otp}</strong> (Click to auto-fill)
          </span>
        `;
        devHint.classList.remove('hidden');
      }
    }
  });
}

function startRegOtpCountdown() {
  let seconds = 300;
  const clock = document.getElementById('reg-countdown-clock');
  if (regCountdownTimer) clearInterval(regCountdownTimer);

  regCountdownTimer = setInterval(() => {
    seconds--;
    if (seconds <= 0) {
      clearInterval(regCountdownTimer);
      if (clock) clock.textContent = '00:00';
      return;
    }
    const mins = String(Math.floor(seconds / 60)).padStart(2, '0');
    const secs = String(seconds % 60).padStart(2, '0');
    if (clock) clock.textContent = `${mins}:${secs}`;
  }, 1000);
}

function setupRegOtpDigitInputs() {
  const inputs = document.querySelectorAll('.reg-otp-digit');
  inputs.forEach((input, index) => {
    input.value = '';
    input.addEventListener('input', (e) => {
      if (e.target.value.length === 1 && index < inputs.length - 1) {
        inputs[index + 1].focus();
      }
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !e.target.value && index > 0) {
        inputs[index - 1].focus();
      }
    });
  });
  if (inputs[0]) inputs[0].focus();
}

/**
 * Submit Username, Email & Password -> Initiate 2FA
 */
async function handleCredentialsSubmit(e) {
  e.preventDefault();
  const username = document.getElementById('login-username').value.trim();
  const email = document.getElementById('login-email') ? document.getElementById('login-email').value.trim() : '';
  const password = document.getElementById('login-password').value;
  const btn = document.getElementById('btn-login-submit');
  const errDiv = document.getElementById('login-error-msg');

  if (errDiv) errDiv.classList.add('hidden');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Authenticating...`;
  }

  try {
    const res = await apiRequest('/auth/login', {
      method: 'POST',
      body: { username, email, password, direct_token: true }
    });

    if (res.token) {
      // Direct sign-in: navigate straight into dashboard without OTP step
      loginSuccess(res.token, res.user);
      return;
    }

    if (res.requires_2fa) {
      state.temp2fa = {
        identifier: res.identifier,
        temp_token: res.temp_token
      };

      // Switch to Step 2
      document.getElementById('login-step-credentials').classList.add('hidden');
      document.getElementById('login-step-otp').classList.remove('hidden');
      document.getElementById('otp-target-display').innerText = res.masked_identifier || res.identifier;

      // If dev_otp provided, show high-visibility auto-fill hint
      const devHint = document.getElementById('otp-dev-hint');
      if (devHint && res.dev_otp) {
        devHint.innerHTML = `
          <div class="p-3 bg-amber-50 border-2 border-amber-400 rounded-xl flex items-center justify-between gap-2 shadow-sm mb-3">
            <div class="flex items-center gap-2">
              <i class="fa-solid fa-envelope-circle-check text-amber-700 text-lg"></i>
              <div class="text-left">
                <span class="text-[10px] text-amber-900 font-extrabold uppercase tracking-wider block">Security 2FA Code (Auto-filled):</span>
                <span class="font-mono font-black text-base text-[#8D153A] tracking-widest">${res.dev_otp}</span>
              </div>
            </div>
            <button type="button" onclick="autoFillOtp('${res.dev_otp}')" class="px-2.5 py-1 bg-[#8D153A] text-white text-xs font-bold rounded-lg hover:bg-[#6e0f2d] transition shadow-sm">
              <i class="fa-solid fa-arrow-down mr-1"></i> Auto-fill
            </button>
          </div>
          <p class="text-[10px] text-slate-500 mb-2 text-center">
            ${res.smtp_configured ? 'Delivered via SMTP relay and auto-filled above.' : '⚡ Local development simulated delivery (SMTP not configured in .env).'}
          </p>
        `;
        devHint.classList.remove('hidden');
        // Auto populate into the boxes without auto-submitting immediately
        autoFillOtpDigitsOnly(res.dev_otp);
      }

      startOtpTimer();
      setupOtpInputHandlers();
    } else if (res.token) {
      // Direct login if 2FA disabled
      loginSuccess(res.token, res.user);
    }
  } catch (error) {
    if (errDiv) {
      errDiv.innerText = error.message || 'Login failed. Verify credentials.';
      errDiv.classList.remove('hidden');
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<span>Continue with 2FA</span> <i class="fa-solid fa-arrow-right text-xs"></i>`;
    }
  }
}

/**
 * 6-Digit OTP Box Management with Enhanced Auto-Focus & Auto-Submit
 */
function setupOtpInputHandlers() {
  const inputs = document.querySelectorAll('.otp-digit-input');
  if (inputs.length === 0) return;

  inputs.forEach((input, idx) => {
    input.value = '';

    // Handle input (keyboard, virtual keypad, auto-fill)
    input.oninput = (e) => {
      const val = input.value;
      if (val.length > 1) {
        input.value = val.slice(-1);
      }

      if (input.value && idx < inputs.length - 1) {
        inputs[idx + 1].focus();
      }

      // If all 6 digits are filled, auto-submit
      const allDigits = Array.from(inputs).map(i => i.value).join('');
      if (allDigits.length === 6) {
        const form = document.getElementById('otp-verification-form');
        if (form) form.requestSubmit();
      }
    };

    // Handle backspace navigation
    input.onkeydown = (e) => {
      if (e.key === 'Backspace' && !input.value && idx > 0) {
        inputs[idx - 1].focus();
      }
    };

    // Handle paste event (e.g. user pastes 6 digits)
    input.onpaste = (e) => {
      e.preventDefault();
      const pasteData = (e.clipboardData || window.clipboardData).getData('text').trim();
      if (/^\d{6}$/.test(pasteData)) {
        pasteData.split('').forEach((char, i) => {
          if (inputs[i]) inputs[i].value = char;
        });
        const form = document.getElementById('otp-verification-form');
        if (form) form.requestSubmit();
      }
    };
  });

  setTimeout(() => {
    if (inputs[0]) inputs[0].focus();
  }, 100);
}

function autoFillOtpDigitsOnly(code) {
  const inputs = document.querySelectorAll('#otp-input-group .otp-digit-input');
  const digits = code.toString().trim().split('');
  inputs.forEach((inp, idx) => {
    inp.value = digits[idx] || '';
  });
  if (inputs[5]) inputs[5].focus();
}

function autoFillOtp(code) {
  autoFillOtpDigitsOnly(code);
  const form = document.getElementById('otp-verification-form');
  if (form) form.requestSubmit();
}

/**
 * Countdown timer for 2FA OTP (5:00)
 */
function startOtpTimer() {
  clearInterval(state.otpTimer);
  state.otpCountdown = 300;
  const clock = document.getElementById('countdown-clock');
  const resendBtn = document.getElementById('btn-resend-otp');
  if (resendBtn) resendBtn.disabled = true;

  state.otpTimer = setInterval(() => {
    state.otpCountdown--;
    const mins = Math.floor(state.otpCountdown / 60).toString().padStart(2, '0');
    const secs = (state.otpCountdown % 60).toString().padStart(2, '0');

    if (clock) clock.innerText = `${mins}:${secs}`;

    if (state.otpCountdown <= 0) {
      clearInterval(state.otpTimer);
      if (resendBtn) resendBtn.disabled = false;
      if (clock) clock.innerText = '00:00 (Expired)';
    }
  }, 1000);
}

/**
 * Resend OTP Code
 */
async function resendOtpCode() {
  if (!state.temp2fa || !state.temp2fa.identifier) return;

  try {
    const res = await apiRequest('/auth/send-otp', {
      method: 'POST',
      body: { identifier: state.temp2fa.identifier, purpose: 'LOGIN' }
    });

    if (res.dev_otp) {
      const devHint = document.getElementById('otp-dev-hint');
      if (devHint) {
        devHint.innerHTML = `
          <div class="p-3 bg-amber-50 border-2 border-amber-400 rounded-xl flex items-center justify-between gap-2 shadow-sm mb-3">
            <div class="flex items-center gap-2">
              <i class="fa-solid fa-envelope-circle-check text-amber-700 text-lg"></i>
              <div class="text-left">
                <span class="text-[10px] text-amber-900 font-extrabold uppercase tracking-wider block">Fresh Security 2FA Code:</span>
                <span class="font-mono font-black text-base text-[#8D153A] tracking-widest">${res.dev_otp}</span>
              </div>
            </div>
            <button type="button" onclick="autoFillOtp('${res.dev_otp}')" class="px-2.5 py-1 bg-[#8D153A] text-white text-xs font-bold rounded-lg hover:bg-[#6e0f2d] transition shadow-sm">
              <i class="fa-solid fa-arrow-down mr-1"></i> Auto-fill
            </button>
          </div>
        `;
        devHint.classList.remove('hidden');
      }
      autoFillOtpDigitsOnly(res.dev_otp);
    }

    startOtpTimer();
    showToast('A fresh verification code has been dispatched to your contact.', 'success');
  } catch (error) {
    showToast(error.message || 'Failed to resend code.', 'error');
  }
}

/**
 * Submit 6-digit OTP to complete login
 */
async function handleOtpSubmit(e) {
  e.preventDefault();
  const inputs = document.querySelectorAll('.otp-digit-input');
  const code = Array.from(inputs).map(i => i.value).join('');
  const btn = document.getElementById('btn-verify-otp-submit');
  const errDiv = document.getElementById('otp-error-msg');

  if (code.length !== 6) {
    if (errDiv) {
      errDiv.innerText = 'Please enter the complete 6-digit code.';
      errDiv.classList.remove('hidden');
    }
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Verifying...`;
  }
  if (errDiv) errDiv.classList.add('hidden');

  try {
    const res = await apiRequest('/auth/verify-otp', {
      method: 'POST',
      body: {
        identifier: state.temp2fa.identifier,
        otp_code: code,
        purpose: 'LOGIN',
        temp_token: state.temp2fa.temp_token
      }
    });

    if (res.token) {
      loginSuccess(res.token, res.user);
    } else {
      throw new Error('Token generation failed.');
    }
  } catch (error) {
    if (errDiv) {
      errDiv.innerText = error.message || 'Invalid or expired OTP code.';
      errDiv.classList.remove('hidden');
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<i class="fa-solid fa-lock-open"></i> Verify Code & Sign In`;
    }
  }
}

function goToDashboard() {
  if (typeof window !== 'undefined' && window.location.protocol.startsWith('http') && window.location.port === '5000') {
    window.location.href = '/dashboard';
  } else if (typeof window !== 'undefined' && window.location.pathname.includes('/public/')) {
    window.location.href = window.location.pathname.replace(/index\.html.*/, 'dashboard.html');
  } else {
    window.location.href = 'dashboard.html';
  }
}

function loginSuccess(token, user) {
  localStorage.setItem('ocodr_token', token);
  localStorage.setItem('ocodr_user', JSON.stringify(user));
  localStorage.setItem('auth_token', token);
  localStorage.setItem('user', JSON.stringify(user));
  state.token = token;
  state.user = user;
  goToDashboard();
}

function handleLogout() {
  localStorage.removeItem('ocodr_token');
  localStorage.removeItem('ocodr_user');
  state.token = null;
  state.user = null;
  if (window.location.protocol.startsWith('http')) {
    window.location.href = '/';
  } else {
    window.location.href = 'index.html';
  }
}

function updateNavAuthStatus() {
  const guestActions = document.getElementById('nav-guest-actions');
  const userActions = document.getElementById('nav-user-actions');
  if (state.token && state.user) {
    if (guestActions) guestActions.classList.add('hidden');
    if (userActions) userActions.classList.remove('hidden');
  } else {
    if (guestActions) guestActions.classList.remove('hidden');
    if (userActions) userActions.classList.add('hidden');
  }
}

function toggleMobileNav() {
  const menu = document.getElementById('mobile-nav-menu');
  if (menu) menu.classList.toggle('hidden');
}

function fillAndVerifyToken(token) {
  const input = document.getElementById('public-qr-token-input');
  if (input) input.value = token;
  verifyPublicToken(token);
}

function handlePublicInputKeydown(e) {
  if (e.key === 'Enter') {
    e.preventDefault();
    verifyPublicToken();
  }
}

async function scanQrFromFile(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;

  try {
    if (typeof Html5Qrcode === 'undefined') {
      alert('QR Scanner library is loading. Please retry.');
      return;
    }
    const html5QrCode = new Html5Qrcode("reader");
    const qrCodeMessage = await html5QrCode.scanFile(file, true);
    document.getElementById('public-qr-token-input').value = qrCodeMessage;
    togglePublicScanner();
    verifyPublicToken(qrCodeMessage);
  } catch (err) {
    alert('No QR code detected in this image. Please upload a clear QR code image.');
  }
}

/* ==========================================================================
   PUBLIC QR CODE VERIFICATION & CAMERA SCANNER
   ========================================================================== */

async function verifyPublicToken(tokenValue) {
  let token = (tokenValue || document.getElementById('public-qr-token-input')?.value || '').trim();
  const resultDiv = document.getElementById('verification-result');

  // If user pasted a URL, extract the token
  if (token.includes('token=')) {
    const match = token.match(/token=([^&]+)/);
    if (match && match[1]) token = decodeURIComponent(match[1]);
  } else if (token.includes('/qr/')) {
    const parts = token.split('/qr/');
    if (parts[1]) token = decodeURIComponent(parts[1].split('?')[0]);
  }

  // Handle multi-line Smart NIC QR payload (Image 3)
  let lookupQuery = token;
  if (token.includes('\n')) {
    const lines = token.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length >= 2 && (lines[0] === '00' || /^\d{9,12}[vVxX]?$/.test(lines[1]))) {
      lookupQuery = lines[1]; // NIC number from Line 2
    }
  }

  if (!token) {
    alert('Please enter or scan a Citizen ID, NIC, or QR verification token.');
    return;
  }

  if (resultDiv) {
    resultDiv.innerHTML = `
      <div class="p-8 text-center text-slate-700 font-bold bg-slate-50 rounded-2xl border border-slate-200">
        <i class="fa-solid fa-spinner fa-spin text-3xl text-[#8D153A] mb-3"></i>
        <p class="text-sm font-extrabold text-slate-900">Validating credential with National Identity Authority registry...</p>
        <p class="text-xs text-slate-500 mt-1">Democratic Socialist Republic of Sri Lanka OCODR Cryptographic Framework</p>
      </div>
    `;
    resultDiv.classList.remove('hidden');
  }

  try {
    let data;
    if (token.includes('\n')) {
      // POST multi-line payload
      data = await apiRequest('/verify/qr', {
        method: 'POST',
        body: { token: token }
      });
    } else {
      data = await apiRequest(`/verify/qr/${encodeURIComponent(lookupQuery)}`);
    }

    if (!data || !data.valid) {
      resultDiv.innerHTML = `
        <div class="p-6 rounded-2xl bg-rose-50 border-2 border-rose-300 text-rose-950 animate-in fade-in shadow-sm">
          <div class="flex items-center gap-3 mb-2">
            <div class="w-10 h-10 rounded-xl bg-rose-600 text-white flex items-center justify-center font-bold text-lg">
              <i class="fa-solid fa-triangle-exclamation"></i>
            </div>
            <div>
              <h4 class="font-black text-base text-rose-950">Invalid or Unrecognized Credential</h4>
              <span class="text-xs text-rose-800 font-semibold">Registry Query Failed</span>
            </div>
          </div>
          <p class="text-xs font-semibold text-rose-800 mt-2">${data.message || 'The presented token, Citizen ID, or NIC is not recognized in the national registry.'}</p>
        </div>
      `;
      return;
    }

    const citizen = data.data;
    const isDeceased = citizen.is_deceased;

    resultDiv.innerHTML = `
      <div class="p-6 sm:p-8 rounded-2xl bg-white border-2 border-[#FFBE29] text-slate-900 shadow-xl animate-in fade-in relative overflow-hidden">
        <div class="sl-ribbon-stripe-thin absolute top-0 left-0 right-0"></div>
        
        <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-slate-200 pb-5 mb-5 mt-2">
          <div class="flex items-center space-x-3.5">
            <div class="w-14 h-14 rounded-2xl bg-amber-50 border border-amber-300 flex items-center justify-center p-1 shrink-0 shadow-sm">
              <img src="/images/sri_lanka_emblem.png" alt="Emblem" class="w-11 h-11 object-contain">
            </div>
            <div>
              <span class="text-[10px] uppercase tracking-widest font-black text-[#8D153A]">
                Democratic Socialist Republic of Sri Lanka
              </span>
              <h4 class="text-xl font-black text-slate-900">${citizen.full_name}</h4>
              <span class="text-xs text-slate-600 font-bold">National Digital Identity Verification &bull; Smart NIC Confirmed</span>
            </div>
          </div>
          <div>
            <span class="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-black ${isDeceased ? 'bg-slate-200 text-slate-900' : 'bg-[#00534E] text-white'} shadow-sm">
              <i class="fa-solid ${isDeceased ? 'fa-monument' : 'fa-circle-check text-amber-300'}"></i>
              ${isDeceased ? 'RECORD: DECEASED' : 'VERIFIED &bull; ACTIVE IDENTITY'}
            </span>
          </div>
        </div>

        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs mb-4">
          <div class="p-3 bg-slate-50 rounded-xl border border-slate-200">
            <span class="text-slate-500 text-[10px] uppercase font-black block">Citizen ID</span>
            <span class="font-mono font-black text-sm text-[#8D153A]">${citizen.citizen_id}</span>
          </div>
          <div class="p-3 bg-slate-50 rounded-xl border border-slate-200">
            <span class="text-slate-500 text-[10px] uppercase font-black block">NIC Number</span>
            <span class="font-mono font-bold text-sm text-slate-900">${citizen.nic_number || citizen.masked_nic}</span>
          </div>
          <div class="p-3 bg-slate-50 rounded-xl border border-slate-200">
            <span class="text-slate-500 text-[10px] uppercase font-black block">Date of Birth</span>
            <span class="font-black text-sm text-slate-900">${citizen.date_of_birth || citizen.year_of_birth}</span>
          </div>
          <div class="p-3 bg-slate-50 rounded-xl border border-slate-200">
            <span class="text-slate-500 text-[10px] uppercase font-black block">Gender</span>
            <span class="font-black text-sm text-slate-900">${citizen.gender}</span>
          </div>
        </div>

        ${citizen.permanent_address ? `
        <div class="p-3 bg-amber-50/50 rounded-xl border border-amber-200 mb-4 text-xs">
          <span class="text-amber-900 text-[10px] uppercase font-black block">Permanent Residence</span>
          <span class="font-bold text-slate-900 block mt-0.5">${citizen.permanent_address}</span>
          ${citizen.birth_place ? `<span class="text-slate-600 block mt-1"><strong>Place of Birth:</strong> ${citizen.birth_place}</span>` : ''}
          ${citizen.card_serial ? `<span class="text-slate-600 block mt-0.5"><strong>Smart NIC Serial:</strong> <span class="font-mono font-bold text-slate-900">${citizen.card_serial}</span></span>` : ''}
        </div>
        ` : ''}

        <div class="text-[11px] font-bold text-slate-700 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-1.5 pt-3 border-t border-slate-200">
          <span><strong>Issuer:</strong> ${citizen.issuer}</span>
          <span class="text-slate-500"><strong>Verified At:</strong> ${new Date(citizen.verification_timestamp).toLocaleString()}</span>
        </div>
      </div>
    `;
  } catch (err) {
    resultDiv.innerHTML = `
      <div class="p-4 bg-red-50 text-red-800 text-xs font-bold rounded-xl border border-red-300">Verification service temporarily unavailable: ${err.message}</div>
    `;
  }
}

function togglePublicScanner() {
  const wrapper = document.getElementById('scanner-wrapper');
  if (!wrapper) return;

  if (wrapper.classList.contains('hidden')) {
    wrapper.classList.remove('hidden');
    startCameraScanner('reader', (decodedText) => {
      document.getElementById('public-qr-token-input').value = decodedText;
      togglePublicScanner();
      verifyPublicToken(decodedText);
    });
  } else {
    stopCameraScanner();
    wrapper.classList.add('hidden');
  }
}

function startCameraScanner(elementId, onScanSuccess) {
  if (typeof Html5Qrcode === 'undefined') {
    alert('QR scanner library is loading. Please retry in a moment.');
    return;
  }

  state.html5QrScanner = new Html5Qrcode(elementId);
  state.html5QrScanner.start(
    { facingMode: 'environment' },
    { fps: 10, qrbox: { width: 250, height: 250 } },
    (decodedText) => {
      onScanSuccess(decodedText);
    },
    (errorMessage) => {
      // Ignore frame errors
    }
  ).catch(err => {
    console.warn('Camera start failed:', err);
    alert('Unable to open camera: ' + (err.message || 'Permission denied'));
  });
}

function stopCameraScanner() {
  if (state.html5QrScanner) {
    state.html5QrScanner.stop().then(() => {
      state.html5QrScanner.clear();
      state.html5QrScanner = null;
    }).catch(err => console.error('Error stopping scanner:', err));
  }
}

/* ==========================================================================
   DASHBOARD INITIALIZATION & ROLE-BASED WORKFLOWS (DASHBOARD.HTML)
   ========================================================================== */

function initPortal() {
  if (window.location.pathname.includes('dashboard')) {
    initDashboard();
  } else {
    updateNavAuthStatus();
    initPreviewSmartNic();
    initNameAutoTranslation();
    updateRegistrationFormPhoto('MALE');
    const regGender = document.getElementById('reg-gender');
    if (regGender && !regGender.dataset.boundGender) {
      regGender.dataset.boundGender = 'true';
      regGender.addEventListener('change', (e) => onRegistrationGenderChange(e.target.value));
    }
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPortal);
} else {
  initPortal();
}

async function initDashboard() {
  // Session check
  if (!state.token || !state.user) {
    if (window.location.protocol.startsWith('http')) {
      window.location.href = '/';
    } else {
      window.location.href = 'index.html';
    }
    return;
  }

  // Populate header details
  const userDisp = document.getElementById('user-display-name');
  const emailDisp = document.getElementById('user-display-email');
  const roleBadge = document.getElementById('header-role-badge');

  if (userDisp) userDisp.innerText = state.user.username;
  if (emailDisp) emailDisp.innerText = state.user.email || 'N/A';
  if (roleBadge) {
    roleBadge.innerText = state.user.role_name;
    roleBadge.className = `ml-3 text-xs font-bold px-2.5 py-1 rounded-full border badge-${state.user.role_name.toLowerCase()}`;
  }

  // Update header avatar from user session
  updateHeaderAvatar(state.user.profile_picture, getInitials(state.user.username));

  // Update sidebar role details
  const sbRole = document.getElementById('sidebar-role-name');
  const sbDesc = document.getElementById('sidebar-role-desc');
  if (sbRole) sbRole.innerText = state.user.role_name;
  if (sbDesc) sbDesc.innerText = `Access Tier: ${state.user.role_name}`;

  // Configure Quick Search in Header for non-citizen roles
  const quickSearch = document.getElementById('quick-search-container');
  if (quickSearch && state.user.role_name !== 'CITIZEN') {
    quickSearch.classList.remove('hidden');
  }

  // Render dynamic role-specific sidebar navigation
  renderRoleSidebar(state.user.role_name);

  // Initial Data Load
  const initialCitizenId = state.user.associated_citizen_id || state.currentCitizenId;
  state.currentCitizenId = initialCitizenId;

  // Set default view based on role
  setDefaultRoleView(state.user.role_name);

  // Load initial citizen profile (skip for ADMIN who manages whole registry)
  if (state.user.role_name !== 'ADMIN') {
    loadCitizenData(initialCitizenId);
  }
}

/**
 * Configure default active tab by role
 */
function setDefaultRoleView(role) {
  switch (role) {
    case 'HOSPITAL':
      switchView('view-medical');
      break;
    case 'SCHOOL':
    case 'UNIVERSITY':
      switchView('view-education');
      break;
    case 'POLICE':
    case 'IMMIGRATION':
      switchView('view-travel');
      break;
    case 'REGISTRAR':
      switchView('view-registrar-birth');
      break;
    case 'ADMIN':
      switchView('view-admin-registry');
      break;
    default: // CITIZEN
      switchView('view-citizen-card');
      break;
  }
}

/**
 * Render Sidebar Navigation tailored to JWT role
 */
function renderRoleSidebar(role) {
  const menu = document.getElementById('sidebar-menu');
  if (!menu) return;

  let html = '';

  const addMenuItem = (viewId, icon, label) => {
    return `
      <button onclick="switchView('${viewId}')" id="nav-${viewId}"
              class="nav-item w-full flex items-center space-x-3 px-3 py-2.5 rounded-xl text-slate-900 hover:bg-slate-100 font-bold transition text-left text-xs">
        <i class="${icon} w-5 text-center text-sm"></i>
        <span>${label}</span>
      </button>
    `;
  };

  if (role === 'CITIZEN') {
    html += addMenuItem('view-citizen-card', 'fa-solid fa-id-card text-[#8D153A]', 'Digital Identity Card');
    html += addMenuItem('view-medical', 'fa-solid fa-heart-pulse text-red-600', 'Health & Vaccines');
    html += addMenuItem('view-education', 'fa-solid fa-graduation-cap text-amber-600', 'Academic Qualifications');
    html += addMenuItem('view-travel', 'fa-solid fa-passport text-[#00534E]', 'Passports & Licences');
    html += addMenuItem('view-vital', 'fa-solid fa-stamp text-emerald-600', 'Civil & Vital Records');
    html += addMenuItem('view-documents', 'fa-solid fa-folder-open text-[#8D153A]', 'My Uploaded Documents');
  } else if (role === 'HOSPITAL') {
    html += addMenuItem('view-medical', 'fa-solid fa-heart-pulse text-red-600', 'Patient Medical Records');
    html += addMenuItem('view-hospital-add', 'fa-solid fa-notes-medical text-red-700', 'Add Clinical Entry');
    html += addMenuItem('view-documents', 'fa-solid fa-folder-open text-slate-700', 'Clinical Documents');
    html += addMenuItem('view-qr-verify', 'fa-solid fa-qrcode text-[#8D153A]', 'Scan Patient QR');
  } else if (role === 'SCHOOL' || role === 'UNIVERSITY') {
    html += addMenuItem('view-education', 'fa-solid fa-graduation-cap text-amber-600', 'Student Academic Profile');
    html += addMenuItem('view-education-add', 'fa-solid fa-plus-circle text-amber-700', 'Add Academic Record');
    html += addMenuItem('view-documents', 'fa-solid fa-folder-open text-slate-700', 'Academic Transcripts');
  } else if (role === 'POLICE' || role === 'IMMIGRATION') {
    html += addMenuItem('view-travel', 'fa-solid fa-shield-halved text-[#00534E]', 'Travel & Licence Checks');
    html += addMenuItem('view-qr-verify', 'fa-solid fa-qrcode text-[#8D153A]', 'Verify Citizen QR Token');
    html += addMenuItem('view-documents', 'fa-solid fa-folder-open text-slate-700', 'Verified Documents');
  } else if (role === 'REGISTRAR') {
    html += addMenuItem('view-registrar-birth', 'fa-solid fa-baby text-[#00534E]', 'Register New Birth');
    html += addMenuItem('view-vital', 'fa-solid fa-stamp text-emerald-700', 'Civil Registry Search');
    html += addMenuItem('view-documents', 'fa-solid fa-folder-open text-slate-700', 'Registry Certificates');
  } else if (role === 'ADMIN') {
    // Group 1: Option 1 - VIEW DETAILS (7 Sectors)
    html += `
      <div class="pt-2 pb-1 px-3 flex items-center justify-between">
        <span class="text-[10px] font-black uppercase tracking-wider text-slate-500">
          <i class="fa-solid fa-eye text-[#8D153A] mr-1"></i> Option 1: View Details
        </span>
        <span class="text-[9px] font-bold px-1.5 py-0.5 bg-rose-50 text-[#8D153A] rounded">7 Sectors</span>
      </div>
    `;
    const addSectorViewItem = (sector, icon, label) => `
      <button onclick="openAdminSectorView('${sector}')" id="nav-view-${sector}"
              class="nav-item w-full flex items-center space-x-2.5 px-3 py-2 rounded-xl text-slate-900 hover:bg-slate-100 font-bold transition text-left text-xs">
        <i class="${icon} w-4 text-center text-xs"></i>
        <span>${label}</span>
      </button>
    `;
    html += addSectorViewItem('citizens', 'fa-solid fa-users text-[#8D153A]', 'Citizens Details');
    html += addSectorViewItem('school', 'fa-solid fa-school text-amber-600', 'School Details');
    html += addSectorViewItem('hospital', 'fa-solid fa-hospital text-red-600', 'Hospital Details');
    html += addSectorViewItem('university', 'fa-solid fa-graduation-cap text-purple-600', 'University Details');
    html += addSectorViewItem('police', 'fa-solid fa-shield-halved text-teal-700', 'Police Details');
    html += addSectorViewItem('immigration', 'fa-solid fa-passport text-orange-600', 'Immigration Details');
    html += addSectorViewItem('registrar', 'fa-solid fa-stamp text-emerald-700', 'Registrar Details');

    // Group 2: Option 2 - DELETE SECTOR RECORDS (7 Sectors)
    html += `
      <div class="pt-3 pb-1 px-3 border-t border-slate-200 mt-2 flex items-center justify-between">
        <span class="text-[10px] font-black uppercase tracking-wider text-rose-700">
          <i class="fa-solid fa-trash-can text-rose-600 mr-1"></i> Option 2: Delete Records
        </span>
        <span class="text-[9px] font-bold px-1.5 py-0.5 bg-rose-100 text-rose-800 rounded">Authority</span>
      </div>
    `;
    const addSectorDeleteItem = (sector, label) => `
      <button onclick="openAdminSectorDelete('${sector}')" id="nav-delete-${sector}"
              class="nav-item w-full flex items-center space-x-2.5 px-3 py-2 rounded-xl text-rose-950 hover:bg-rose-50 font-bold transition text-left text-xs">
        <i class="fa-solid fa-trash-can w-4 text-center text-rose-600 text-xs"></i>
        <span>${label}</span>
      </button>
    `;
    html += addSectorDeleteItem('citizens', 'Delete Citizens');
    html += addSectorDeleteItem('school', 'Delete School Records');
    html += addSectorDeleteItem('hospital', 'Delete Hospital Records');
    html += addSectorDeleteItem('university', 'Delete University Records');
    html += addSectorDeleteItem('police', 'Delete Police Records');
    html += addSectorDeleteItem('immigration', 'Delete Immigration Records');
    html += addSectorDeleteItem('registrar', 'Delete Registrar Records');

    // Group 3: Governance & Audit Trail
    html += `
      <div class="pt-3 pb-1 px-3 border-t border-slate-200 mt-2">
        <span class="text-[10px] font-black uppercase tracking-wider text-slate-500">Governance & Audit</span>
      </div>
    `;
    html += addMenuItem('view-admin-audit', 'fa-solid fa-shield-halved text-slate-800', 'Compliance Audit Trail');
    html += addMenuItem('view-citizen-card', 'fa-solid fa-id-card text-slate-800', 'Global Citizen Card');
    html += addMenuItem('view-documents', 'fa-solid fa-folder-open text-slate-700', 'Global Documents');
  }

  menu.innerHTML = html;
}

/**
 * Switch View Panels
 */
function switchView(viewId) {
  state.activeView = viewId;

  // Hide all view sections
  const sections = document.querySelectorAll('main > section');
  sections.forEach(s => s.classList.add('hidden'));

  // Highlight active sidebar item
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.classList.remove('bg-rose-50', 'text-[#8D153A]', 'border-l-4', 'border-[#8D153A]');
  });

  const activeSec = document.getElementById(viewId);
  const activeBtn = document.getElementById(`nav-${viewId}`);

  if (activeSec) activeSec.classList.remove('hidden');
  if (activeBtn) activeBtn.classList.add('bg-rose-50', 'text-[#8D153A]', 'border-l-4', 'border-[#8D153A]');

  // Ensure citizen context bar is hidden in admin section or for admin/citizen roles
  const contextBar = document.getElementById('official-citizen-context-bar');
  if (contextBar) {
    if (viewId === 'view-admin-registry' || viewId === 'view-admin-audit' || state.user?.role_name === 'ADMIN' || state.user?.role_name === 'CITIZEN') {
      contextBar.classList.add('hidden');
    }
  }

  // Trigger load if switching to admin registry
  if (viewId === 'view-admin-registry') {
    updateAdminSectorButtonsUI();
    loadAdminRegistryData();
  }

  // Trigger load if switching to audit logs
  if (viewId === 'view-admin-audit') {
    loadAdminAuditLogs();
  }

  // Trigger documents load
  if (viewId === 'view-documents') {
    loadCitizenDocuments(state.currentCitizenId);
  }
}

/**
 * Trilingual Address Formatter for Sri Lankan Smart NIC Back Face
 */
function formatTrilingualAddress(addr, demo) {
  if (demo && demo.address_si && demo.address_ta) {
    return {
      si: demo.address_si,
      ta: demo.address_ta,
      en: (demo.permanent_address || demo.current_address || 'N/A').toUpperCase()
    };
  }
  const raw = (addr || demo?.permanent_address || demo?.current_address || '').trim();
  const lower = raw.toLowerCase();

  // Known seeds / official citizens:
  if (lower.includes('galle road') || lower.includes('kollupitiya') || lower.includes('colombo 03') || lower.includes('colombo 3')) {
    return {
      si: 'අංක 42, ගාලු පාර, කොල්ලුපිටිය, කොළඹ 03.',
      ta: 'இல. 42, காலி வீதி, கொள்ளுப்பிட்டி, கொழும்பு 03.',
      en: (raw || 'NO. 42, GALLE ROAD, KOLLUPITIYA, COLOMBO 03, SRI LANKA').toUpperCase()
    };
  }

  if (lower.includes('kondadeniya') || lower.includes('katugastota') || lower.includes('186/c')) {
    return {
      si: '186/C, පහල කොණ්ඩදෙණිය, කටුගස්තොට.',
      ta: '186/C, கீழ் கொண்டதெணிய, கட்டுகஸ்தோட்டை.',
      en: (raw || '186/C, PAHALA KONDADENIYA, KATUGASTOTA.').toUpperCase()
    };
  }

  // Generic fallback:
  return {
    si: demo?.address_si || raw || 'ලිපිනය සටහන් කර නැත',
    ta: demo?.address_ta || raw || 'முகவரி பதிவு செய்யப்படவில்லை',
    en: raw ? raw.toUpperCase() : 'N/A'
  };
}

/**
 * Trilingual Birth Place Formatter
 */
function formatTrilingualBirthPlace(place, demo) {
  if (demo && demo.birth_place_si && demo.birth_place_ta) {
    return {
      si: demo.birth_place_si,
      ta: demo.birth_place_ta,
      en: (demo.birth_place || 'N/A').toUpperCase()
    };
  }
  const raw = (place || demo?.birth_place || '').trim();
  const lower = raw.toLowerCase();
  if (lower.includes('colombo')) {
    return { si: 'කොළඹ', ta: 'கொழும்பு', en: 'COLOMBO' };
  }
  if (lower.includes('kandy')) {
    return { si: 'මහනුවර', ta: 'கண்டி', en: 'KANDY' };
  }
  if (lower.includes('galle')) {
    return { si: 'ගාල්ල', ta: 'காலி', en: 'GALLE' };
  }
  if (lower.includes('jaffna')) {
    return { si: 'යාපනය', ta: 'யாழ்ப்பாணம்', en: 'JAFFNA' };
  }
  return {
    si: demo?.birth_place_si || raw || 'නොදනී',
    ta: demo?.birth_place_ta || raw || 'தெரியாது',
    en: raw ? raw.toUpperCase() : 'N/A'
  };
}

/**
 * Load Citizen Record based on Requesting Role (Strict RBAC Partitioning)
 */
async function loadCitizenData(citizenId) {
  if (!citizenId) return;

  try {
    const res = await apiRequest(`/citizens/${citizenId}`);
    if (!res.success || !res.data) throw new Error('Citizen record not found.');

    const d = res.data;
    state.inspectedCitizen = d;

    // Update Context Bar for officials
    updateCitizenContextBar(d);

    // 1. Update Digital ID Card View (Sri Lankan Smart NIC Front & Back)
    if (d.demographics) {
      const demo = d.demographics;
      setElementText('card-full-name', (demo.full_name || '').toUpperCase());
      setElementText('card-name-si', demo.name_si || demo.full_name);
      setElementText('card-name-ta', demo.name_ta || demo.full_name);
      setElementText('card-citizen-id', demo.citizen_id);
      setElementText('card-citizen-id-header', demo.citizen_id);
      setElementText('card-nic-number', demo.nic_number || 'N/A');

      const dobFormatted = demo.date_of_birth ? demo.date_of_birth.replace(/-/g, '/') : 'N/A';
      setElementText('card-dob', dobFormatted);

      // Trilingual gender
      const gStr = (demo.gender || '').toUpperCase();
      const isMale = gStr.startsWith('M');
      const isFemale = gStr.startsWith('F');
      const genderTrilingual = isMale ? 'පුරුෂ / ஆண் / Male' : (isFemale ? 'ස්ත්‍රී / பெண் / Female' : 'වෙනත් / பிற / Other');
      setElementText('card-gender-trilingual', genderTrilingual);
      setElementText('card-gender', demo.gender || 'N/A');

      // Holder signature
      const sigName = demo.signature_name || (demo.first_name || 'Holder');
      setElementText('card-holder-signature', sigName);

      // Front card serial
      setElementText('card-serial-front', demo.card_serial || 'SL-2024-884920');

      // Back Face Elements: Prominent Trilingual Address
      const addrTrilingual = formatTrilingualAddress(demo.permanent_address, demo);
      setElementText('card-address-si', addrTrilingual.si);
      setElementText('card-address-ta', addrTrilingual.ta);
      setElementText('card-address', addrTrilingual.en);

      // Current address container (if different from permanent)
      const currentAddrContainer = document.getElementById('card-current-address-container');
      const currentAddrEl = document.getElementById('card-current-address');
      if (currentAddrContainer && currentAddrEl) {
        const cur = (demo.current_address || '').trim();
        const perm = (demo.permanent_address || '').trim();
        if (cur && cur.toLowerCase() !== perm.toLowerCase()) {
          currentAddrEl.textContent = cur.toUpperCase();
          currentAddrContainer.classList.remove('hidden');
        } else {
          currentAddrContainer.classList.add('hidden');
        }
      }

      // Back Face: Trilingual Birth Place
      const birthTrilingual = formatTrilingualBirthPlace(demo.birth_place, demo);
      setElementText('card-birthplace-si', birthTrilingual.si);
      setElementText('card-birthplace-ta', birthTrilingual.ta);
      setElementText('card-birthplace', birthTrilingual.en);

      const issueFormatted = demo.date_of_issue ? demo.date_of_issue.replace(/-/g, '/') : '2025/01/27';
      const expiryFormatted = demo.date_of_expiry ? demo.date_of_expiry.replace(/-/g, '/') : '2035/01/26';
      setElementText('card-issue-date', issueFormatted);
      setElementText('card-expiry-date', expiryFormatted);
      setElementText('card-serial', demo.card_serial || '05CBD-220');
      setElementText('card-blood-group', demo.blood_group || 'O+');

      // Render Dynamic Official Citizen Photo
      renderCitizenCardPhoto(demo);

      // Generate Digital Smart NIC QR Code (Image 3 format)
      const qrPayload = generateSmartNicQrText(demo);
      renderCardQrCode(qrPayload);

      // Configure Action Buttons: Strictly only ADMIN can edit information
      const editBtn = document.getElementById('btn-card-edit-info');
      if (editBtn) {
        if ((state.user?.role_name || '').toUpperCase() === 'ADMIN') {
          editBtn.classList.remove('hidden');
        } else {
          editBtn.classList.add('hidden');
        }
      }

      // Configure Action Buttons: Strictly only ADMIN can delete information
      const deleteBtn = document.getElementById('btn-card-delete-info');
      if (deleteBtn) {
        if ((state.user?.role_name || '').toUpperCase() === 'ADMIN') {
          deleteBtn.classList.remove('hidden');
        } else {
          deleteBtn.classList.add('hidden');
        }
      }
    }

    // 2. Update Medical View
    if (d.medical_records || d.vaccination_records) {
      setElementText('med-blood-display', d.blood_group ? `${d.blood_group} (Rh Verified)` : 'Not Documented');
      setElementText('med-allergies-display', d.documented_allergies || 'None Documented');
      renderMedicalTable(d.medical_records || []);
      renderVaccineTable(d.vaccination_records || []);

      const medAddBtn = document.getElementById('medical-add-trigger');
      if (medAddBtn && (state.user.role_name === 'HOSPITAL' || state.user.role_name === 'ADMIN')) {
        medAddBtn.classList.remove('hidden');
        const diagCitInput = document.getElementById('diag-citizen-id');
        if (diagCitInput) diagCitInput.value = citizenId;
      }
    }

    // 3. Update Education View
    if (d.higher_education || d.school_education || d.exam_results) {
      renderHigherEdTable(d.higher_education || []);
      renderSchoolEdTable(d.school_education || []);
      renderExamResultsTable(d.exam_results || []);

      const eduAddBtn = document.getElementById('education-add-trigger');
      if (eduAddBtn) {
        if (['CITIZEN', 'SCHOOL', 'UNIVERSITY'].includes(state.user?.role_name)) {
          eduAddBtn.classList.remove('hidden');
          const eduCitInput = document.getElementById('edu-citizen-id');
          if (eduCitInput) {
            eduCitInput.value = citizenId;
            if (state.user?.role_name === 'CITIZEN') eduCitInput.readOnly = true;
          }
        } else {
          eduAddBtn.classList.add('hidden');
        }
      }
    }

    // 4. Update Travel & Passports View
    if (d.passports || d.driving_licences) {
      renderPassportsList(d.passports || []);
      renderLicencesList(d.driving_licences || []);
    }

    const travelAddActions = document.getElementById('travel-add-actions');
    if (travelAddActions) {
      if (['CITIZEN', 'IMMIGRATION', 'POLICE'].includes(state.user?.role_name)) {
        travelAddActions.classList.remove('hidden');
        const passCitInput = document.getElementById('pass-citizen-id');
        if (passCitInput) {
          passCitInput.value = citizenId;
          if (state.user?.role_name === 'CITIZEN') passCitInput.readOnly = true;
        }
        const licCitInput = document.getElementById('lic-citizen-id');
        if (licCitInput) {
          licCitInput.value = citizenId;
          if (state.user?.role_name === 'CITIZEN') licCitInput.readOnly = true;
        }
      } else {
        travelAddActions.classList.add('hidden');
      }
    }

    // 5. Update Civil / Vital Status View
    if (d.birth_registrations || d.marriages) {
      renderCivilStatus(d.birth_registrations || [], d.marriages || []);
    }

    const vitalAddActions = document.getElementById('vital-add-actions');
    if (vitalAddActions) {
      if (['CITIZEN', 'REGISTRAR'].includes(state.user?.role_name)) {
        vitalAddActions.classList.remove('hidden');
        const marriageCitInput = document.getElementById('marriage-spouse-one-id');
        if (marriageCitInput) {
          marriageCitInput.value = citizenId;
          if (state.user?.role_name === 'CITIZEN') marriageCitInput.readOnly = true;
        }
      } else {
        vitalAddActions.classList.add('hidden');
      }
    }

    // Pre-fill target citizen in upload form
    const upCit = document.getElementById('upload-citizen-id');
    if (upCit) upCit.value = citizenId;

  } catch (error) {
    showToast(error.message || 'Failed to load citizen data.', 'error');
  }
}

function updateCitizenContextBar(data) {
  const bar = document.getElementById('official-citizen-context-bar');
  if (!bar) return;

  if (state.user?.role_name === 'CITIZEN' || state.user?.role_name === 'ADMIN' || state.activeView === 'view-admin-registry' || state.activeView === 'view-admin-audit') {
    bar.classList.add('hidden');
    return;
  }

  const name = data.demographics ? data.demographics.full_name : 'National Citizen';
  document.getElementById('context-citizen-name').innerText = name;
  document.getElementById('context-citizen-id').innerText = data.citizen_id;
  bar.classList.remove('hidden');
}

function clearInspectedCitizen() {
  state.currentCitizenId = 'LK-19900512-0042';
  loadCitizenData(state.currentCitizenId);
}

/**
 * Header Search for Officials
 */
async function executeHeaderSearch() {
  const query = document.getElementById('header-citizen-search')?.value.trim();
  if (!query) return;

  try {
    const res = await apiRequest(`/citizens/search?q=${encodeURIComponent(query)}`);
    if (res.data && res.data.length > 0) {
      const match = res.data[0];
      state.currentCitizenId = match.citizen_id;
      loadCitizenData(match.citizen_id);
      showToast(`Loaded citizen record for ${match.full_name} (${match.citizen_id})`, 'success');
    } else {
      showToast(`No citizen records matched query "${query}".`, 'error');
    }
  } catch (error) {
    showToast(error.message || 'Search lookup failed.', 'error');
  }
}

/**
 * Generate authentic 11-line Sri Lankan Smart NIC QR text payload (matching Image 3)
 */
function generateSmartNicQrText(c) {
  if (!c) return '';
  const nic = c.nic_number || '200530702203';
  let dob = '2005-11-02';
  if (c.date_of_birth) {
    dob = c.date_of_birth.replace(/\//g, '-');
  }
  const sex = (c.gender || 'M').toUpperCase().startsWith('F') ? 'F' : 'M';
  let issue = '2025-01-27';
  if (c.date_of_issue) {
    issue = c.date_of_issue.replace(/\//g, '-');
  }
  const serial = c.card_serial || '05CBD-220';
  const name = (c.full_name || 'WASIM BARI AHMADH BILAAL').toUpperCase();
  const address = (c.permanent_address || c.current_address || '186/C, PAHALA KONDADENIYA, KATUGASTOTA.').toUpperCase();
  const birthplace = (c.birth_place || 'KANDY').toUpperCase();
  const hashToken = (c.qr_token || '20378454CBC6431CA51DA25E3A5CD78E').replace(/[^a-zA-Z0-9]/g, '').toUpperCase() + '#';
  let expiry = '2035/01/26';
  if (c.date_of_expiry) {
    expiry = c.date_of_expiry.replace(/-/g, '/');
  }

  return [
    '00',
    nic,
    dob,
    sex,
    issue,
    serial,
    name,
    address,
    birthplace,
    hashToken,
    expiry
  ].join('\n');
}

/**
 * QR Code Rendering on Digital ID Card (Dashboard)
 */
function renderCardQrCode(payload) {
  const container = document.getElementById('card-qrcode');
  if (!container) return;

  container.innerHTML = '';
  if (typeof QRCode !== 'undefined') {
    new QRCode(container, {
      text: payload,
      width: 80,
      height: 80,
      colorDark: "#0f172a",
      colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.M
    });
  }
}

/**
 * QR Code Rendering on Preview ID Card (Homepage index.html)
 */
function renderPreviewCardQrCode(payload) {
  const container = document.getElementById('preview-card-qrcode');
  if (!container) return;

  container.innerHTML = '';
  if (typeof QRCode !== 'undefined') {
    new QRCode(container, {
      text: payload,
      width: 78,
      height: 78,
      colorDark: "#0f172a",
      colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.M
    });
  }
}

/**
 * Smart NIC 3D Flip Controller - Dashboard
 */
function toggleSmartNicFlip() {
  const container = document.getElementById('smart-nic-container');
  const flipper = document.getElementById('smart-nic-flipper');
  if (container) container.classList.remove('dual-view');
  if (flipper) {
    flipper.classList.toggle('flipped');
    const isFlipped = flipper.classList.contains('flipped');
    updateNicViewButtons('smart-nic', isFlipped ? 'back' : 'front');
  }
}

function showSmartNicFace(face) {
  const container = document.getElementById('smart-nic-container');
  const flipper = document.getElementById('smart-nic-flipper');
  const wrapper = document.getElementById('nic-section-wrapper');
  if (!flipper) return;

  if (face === 'dual') {
    if (container) container.classList.add('dual-view');
    if (wrapper) { wrapper.classList.remove('max-w-2xl'); wrapper.classList.add('max-w-5xl'); }
    flipper.classList.remove('flipped');
  } else if (face === 'back') {
    if (container) container.classList.remove('dual-view');
    if (wrapper) { wrapper.classList.remove('max-w-5xl'); wrapper.classList.add('max-w-2xl'); }
    flipper.classList.add('flipped');
  } else {
    if (container) container.classList.remove('dual-view');
    if (wrapper) { wrapper.classList.remove('max-w-5xl'); wrapper.classList.add('max-w-2xl'); }
    flipper.classList.remove('flipped');
  }
  updateNicViewButtons('smart-nic', face);
}

/**
 * Smart NIC 3D Flip Controller - Homepage Preview
 */
function togglePreviewFlip() {
  const container = document.getElementById('preview-nic-container');
  const flipper = document.getElementById('preview-nic-flipper');
  const wrapper = document.getElementById('preview-nic-section-wrapper');
  if (container) container.classList.remove('dual-view');
  if (wrapper) { wrapper.classList.remove('max-w-5xl'); wrapper.classList.add('max-w-2xl'); }
  if (flipper) {
    flipper.classList.toggle('flipped');
    const isFlipped = flipper.classList.contains('flipped');
    updateNicViewButtons('preview', isFlipped ? 'back' : 'front');
  }
}

function showPreviewFace(face) {
  const container = document.getElementById('preview-nic-container');
  const flipper = document.getElementById('preview-nic-flipper');
  const wrapper = document.getElementById('preview-nic-section-wrapper');
  if (!flipper) return;

  if (face === 'dual') {
    if (container) container.classList.add('dual-view');
    if (wrapper) { wrapper.classList.remove('max-w-2xl'); wrapper.classList.add('max-w-5xl'); }
    flipper.classList.remove('flipped');
  } else if (face === 'back') {
    if (container) container.classList.remove('dual-view');
    if (wrapper) { wrapper.classList.remove('max-w-5xl'); wrapper.classList.add('max-w-2xl'); }
    flipper.classList.add('flipped');
  } else {
    if (container) container.classList.remove('dual-view');
    if (wrapper) { wrapper.classList.remove('max-w-5xl'); wrapper.classList.add('max-w-2xl'); }
    flipper.classList.remove('flipped');
  }
  updateNicViewButtons('preview', face);
}

function updateNicViewButtons(context, face) {
  const isDash = context === 'smart-nic';
  const frontBtn = document.getElementById(isDash ? 'btn-show-front' : 'btn-preview-front');
  const backBtn = document.getElementById(isDash ? 'btn-show-back' : 'btn-preview-back');
  const dualBtn = document.getElementById(isDash ? 'btn-show-dual' : 'btn-preview-dual');

  const activeCls = 'px-3 py-1.5 rounded-xl bg-[#8D153A] text-white shadow-sm transition';
  const inactiveCls = 'px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 transition';

  if (frontBtn) frontBtn.className = face === 'front' ? activeCls : inactiveCls;
  if (backBtn) backBtn.className = face === 'back' ? activeCls : inactiveCls;
  if (dualBtn) dualBtn.className = face === 'dual' ? activeCls : inactiveCls;
}

const samplePersonas = {
  MALE: {
    photo: '/images/citizen_bilaal.jpg',
    citizen_id: 'LK-20051102-0220',
    nic_number: '200530702203',
    full_name: 'WASIM BARI AHMADH BILAAL',
    name_si: 'වසීම් බාරි අහ්මද් බිලාල්',
    name_ta: 'வசீம் பாரி அஹ்மத் பிலால்',
    gender: 'MALE',
    gender_trilingual: 'පුරුෂ / ஆண் / Male',
    dob: '2005/11/02',
    blood_group: 'O+',
    signature: 'Bilaal',
    permanent_address: '186/C, PAHALA KONDADENIYA, KATUGASTOTA, SRI LANKA',
    address_si: '186/C, පහල කොණ්ඩදෙණිය, කටුගස්තොට.',
    address_ta: '186/C, கீழ் கொண்டதெணிய, கட்டுகஸ்தோட்டை.',
    birth_place: 'KANDY',
    qr_token: '20378454CBC6431CA51DA25E3A5CD78E'
  },
  FEMALE: {
    photo: '/images/citizen_yumna.jpg',
    citizen_id: 'LK-19900512-0042',
    nic_number: '199055401234',
    full_name: 'YUMNA FATHIMA SILVA',
    name_si: 'යුම්නා ෆාතිමා සිල්වා',
    name_ta: 'யும்னா பாத்திமா சில்வா',
    gender: 'FEMALE',
    gender_trilingual: 'ස්ත්‍රී / பெண் / Female',
    dob: '1990/05/12',
    blood_group: 'A+',
    signature: 'Yumna',
    permanent_address: '45/2, GALLE ROAD, COLOMBO 03, SRI LANKA',
    address_si: '45/2, ගාලු පාර, කොළඹ 03.',
    address_ta: '45/2, காலி வீதி, கொழும்பு 03.',
    birth_place: 'COLOMBO',
    qr_token: '89F2A901C4B56782E09871123456789A'
  }
};

/**
 * Initialize preview card on homepage with Wasim Bilaal's Smart NIC details & QR code
 */
function initPreviewSmartNic() {
  const container = document.getElementById('preview-card-qrcode');
  if (!container) return;

  setPreviewCardGender('MALE');
}

/**
 * Switch Gender Persona on the Showcase Citizen Card (Home Page)
 */
function setPreviewCardGender(gender) {
  const g = (gender || 'MALE').toUpperCase().startsWith('F') ? 'FEMALE' : 'MALE';
  const p = samplePersonas[g];

  // 1. Update Showcase Citizen Card Front Face Photo
  const photoEl = document.getElementById('preview-card-photo');
  if (photoEl) {
    photoEl.src = p.photo;
    photoEl.alt = `${p.full_name} (${g})`;
  }

  // 2. Update Showcase Citizen Card Text Fields
  setElementText('preview-card-full-name', p.full_name);
  setElementText('preview-card-name-si', p.name_si);
  setElementText('preview-card-name-ta', p.name_ta);
  setElementText('preview-card-gender-trilingual', p.gender_trilingual);
  setElementText('preview-card-citizen-id', p.citizen_id);
  setElementText('preview-card-citizen-id-header', p.citizen_id);
  setElementText('preview-card-nic-number', p.nic_number);
  setElementText('preview-card-dob', p.dob);
  setElementText('preview-card-signature', p.signature);
  setElementText('preview-card-blood-group', p.blood_group);

  // 3. Update Back Face Address if elements exist
  setElementText('preview-card-address', p.permanent_address);
  setElementText('preview-card-address-si', p.address_si);
  setElementText('preview-card-address-ta', p.address_ta);

  // 4. Update QR Code for the active gender persona
  const payload = generateSmartNicQrText({
    nic_number: p.nic_number,
    date_of_birth: p.dob.replace(/\//g, '-'),
    gender: g === 'MALE' ? 'M' : 'F',
    date_of_issue: '2025-01-27',
    card_serial: g === 'MALE' ? '05CBD-220' : '90SL-042',
    full_name: p.full_name,
    permanent_address: p.permanent_address,
    birth_place: p.birth_place,
    qr_token: p.qr_token,
    date_of_expiry: '2035/01/26'
  });
  renderPreviewCardQrCode(payload);

  // 5. Update Inspect View Gender Buttons
  const btnMale = document.getElementById('btn-card-gender-male');
  const btnFemale = document.getElementById('btn-card-gender-female');
  if (btnMale && btnFemale) {
    if (g === 'MALE') {
      btnMale.className = 'px-2.5 py-1 rounded-lg text-xs font-extrabold transition shadow-xs bg-[#8D153A] text-white';
      btnFemale.className = 'px-2.5 py-1 rounded-lg text-xs font-extrabold transition shadow-xs text-slate-700 hover:text-slate-900 bg-transparent';
    } else {
      btnFemale.className = 'px-2.5 py-1 rounded-lg text-xs font-extrabold transition shadow-xs bg-[#8D153A] text-white';
      btnMale.className = 'px-2.5 py-1 rounded-lg text-xs font-extrabold transition shadow-xs text-slate-700 hover:text-slate-900 bg-transparent';
    }
  }

  // 6. Sync Registration Form Gender & Form Photo if available
  const regGenderSelect = document.getElementById('reg-gender');
  if (regGenderSelect && regGenderSelect.value !== g) {
    regGenderSelect.value = g;
  }
  updateRegistrationFormPhoto(g);
}

/**
 * Handle Gender Selection on the Citizen Registration Form
 */
function onRegistrationGenderChange(genderVal) {
  const g = (genderVal || 'MALE').toUpperCase().startsWith('F') ? 'FEMALE' : 'MALE';
  
  // 1. Update Registration Form Photo Preview
  updateRegistrationFormPhoto(g);

  // 2. Also update the Citizen Card showcase section on index.html
  setPreviewCardGender(g);
}

/**
 * Update the photo preview box on the Registration Form
 */
function updateRegistrationFormPhoto(gender) {
  const isFemale = (gender || '').toUpperCase().startsWith('F');
  const photoSrc = isFemale ? '/images/citizen_yumna.jpg' : '/images/citizen_bilaal.jpg';
  const photoName = isFemale ? 'Female Photo' : 'Male Photo';
  const photoDesc = isFemale ? 'Female Picture (Yumna)' : 'Male Picture (Bilaal)';

  const formPhoto = document.getElementById('reg-form-photo');
  if (formPhoto) {
    formPhoto.src = photoSrc;
    formPhoto.alt = `${photoName} Preview`;
  }

  const badge = document.getElementById('reg-form-photo-badge');
  if (badge) {
    badge.textContent = photoName;
    badge.className = isFemale 
      ? 'absolute bottom-0 inset-x-0 bg-emerald-800/90 text-amber-200 text-[8px] font-black py-0.5 text-center uppercase tracking-tight'
      : 'absolute bottom-0 inset-x-0 bg-[#8D153A]/90 text-amber-300 text-[8px] font-black py-0.5 text-center uppercase tracking-tight';
  }

  const statusEl = document.getElementById('reg-form-photo-status');
  if (statusEl) {
    statusEl.innerHTML = `<i class="fa-solid fa-circle-check"></i> ${photoDesc}`;
  }
}

/**
 * Handle Gender Selection on the Birth Registration Form (Dashboard)
 */
function onBirthGenderChange(genderVal) {
  const isFemale = (genderVal || '').toUpperCase().startsWith('F');
  const photoSrc = isFemale ? '/images/citizen_yumna.jpg' : '/images/citizen_bilaal.jpg';
  const label = isFemale ? 'Female Portrait Assigned' : 'Male Portrait Assigned';

  const birthPhoto = document.getElementById('birth-form-photo');
  if (birthPhoto) birthPhoto.src = photoSrc;

  const birthLabel = document.getElementById('birth-form-photo-label');
  if (birthLabel) birthLabel.textContent = label;
}

/**
 * Switch Gender Persona on the Dashboard Citizen Card
 */
function setDashboardCardGender(gender) {
  const g = (gender || 'MALE').toUpperCase().startsWith('F') ? 'FEMALE' : 'MALE';
  const p = samplePersonas[g];

  // Update card elements in dashboard
  const photoContainer = document.getElementById('card-photo-container');
  if (photoContainer) {
    photoContainer.innerHTML = `
      <img id="card-citizen-photo" 
           src="${p.photo}" 
           onerror="this.onerror=null; this.src='${p.photo}';" 
           class="w-full h-full object-cover" 
           alt="${p.full_name} (${g})">
      <button onclick="openPhotoUploadModal('${p.citizen_id}')" 
              class="absolute bottom-1.5 right-1.5 bg-[#8D153A] hover:bg-[#660B25] text-white w-7 h-7 rounded-full flex items-center justify-center text-xs shadow-md border-2 border-[#FFBE29] transition" 
              title="Upload / Change Profile Picture">
        <i class="fa-solid fa-camera text-[10px]"></i>
      </button>
    `;
  }

  setElementText('card-full-name', p.full_name);
  setElementText('card-name-si', p.name_si);
  setElementText('card-name-ta', p.name_ta);
  setElementText('card-citizen-id', p.citizen_id);
  setElementText('card-citizen-id-header', p.citizen_id);
  setElementText('card-nic-number', p.nic_number);
  setElementText('card-dob', p.dob);
  setElementText('card-gender-trilingual', p.gender_trilingual);
  setElementText('card-gender', g);
  setElementText('card-holder-signature', p.signature);
  setElementText('card-blood-group', p.blood_group);

  // Update button highlights if dashboard gender buttons exist
  const btnMale = document.getElementById('btn-dash-card-gender-male');
  const btnFemale = document.getElementById('btn-dash-card-gender-female');
  if (btnMale && btnFemale) {
    if (g === 'MALE') {
      btnMale.className = 'px-2.5 py-1 rounded-lg text-xs font-extrabold transition shadow-xs bg-[#8D153A] text-white';
      btnFemale.className = 'px-2.5 py-1 rounded-lg text-xs font-extrabold transition shadow-xs text-slate-700 hover:text-slate-900 bg-transparent';
    } else {
      btnFemale.className = 'px-2.5 py-1 rounded-lg text-xs font-extrabold transition shadow-xs bg-[#8D153A] text-white';
      btnMale.className = 'px-2.5 py-1 rounded-lg text-xs font-extrabold transition shadow-xs text-slate-700 hover:text-slate-900 bg-transparent';
    }
  }

  // Update QR
  const payload = generateSmartNicQrText({
    nic_number: p.nic_number,
    date_of_birth: p.dob.replace(/\//g, '-'),
    gender: g === 'MALE' ? 'M' : 'F',
    date_of_issue: '2025-01-27',
    card_serial: g === 'MALE' ? '05CBD-220' : '90SL-042',
    full_name: p.full_name,
    permanent_address: p.permanent_address,
    birth_place: p.birth_place,
    qr_token: p.qr_token,
    date_of_expiry: '2035/01/26'
  });
  renderCardQrCode(payload);
}

function copyQrToken() {
  const token = state.inspectedCitizen?.demographics?.qr_token || state.currentCitizenId;
  navigator.clipboard.writeText(token).then(() => {
    showToast('Citizen QR Token copied to clipboard!', 'success');
  });
}

/**
 * Table Render Helpers
 */
function renderMedicalTable(records) {
  const tbody = document.getElementById('table-medical-diagnoses');
  if (!tbody) return;

  if (records.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-slate-400">No medical diagnoses documented.</td></tr>`;
    return;
  }

  tbody.innerHTML = records.map(r => `
    <tr class="hover:bg-slate-50 transition">
      <td class="p-3 font-semibold text-slate-900">${r.diagnosed_condition}</td>
      <td class="p-3">
        <span class="px-2 py-0.5 rounded text-[10px] font-bold ${r.chronic_flag ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-700'}">
          ${r.chronic_flag ? 'CHRONIC' : 'ACUTE'}
        </span>
      </td>
      <td class="p-3 text-slate-600">${r.hospital_name}</td>
      <td class="p-3 text-slate-600">${r.treating_physician || 'Consultant'}</td>
      <td class="p-3 text-slate-500">${r.diagnosis_date}</td>
      <td class="p-3 text-slate-600 max-w-xs truncate">${r.notes || '-'}</td>
    </tr>
  `).join('');
}

function renderVaccineTable(records) {
  const tbody = document.getElementById('table-vaccination-records');
  if (!tbody) return;

  if (records.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-slate-400">No vaccination entries documented.</td></tr>`;
    return;
  }

  tbody.innerHTML = records.map(v => `
    <tr class="hover:bg-slate-50 transition">
      <td class="p-3 font-semibold text-emerald-950">${v.vaccine_name}</td>
      <td class="p-3 font-bold text-slate-700">Dose ${v.dose_number}</td>
      <td class="p-3 font-mono text-slate-500">${v.batch_number || 'BATCH-STD'}</td>
      <td class="p-3 text-slate-600">${v.administration_date}</td>
      <td class="p-3 text-slate-600">${v.center_name}</td>
      <td class="p-3 text-slate-500">${v.administered_by || 'Authorized Officer'}</td>
    </tr>
  `).join('');
}

function renderHigherEdTable(records) {
  const tbody = document.getElementById('table-higher-education');
  if (!tbody) return;

  if (records.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-slate-400">No higher education records found.</td></tr>`;
    return;
  }

  tbody.innerHTML = records.map(e => `
    <tr class="hover:bg-slate-50 transition">
      <td class="p-3 font-semibold text-slate-900">${e.institution_name}</td>
      <td class="p-3 font-bold text-amber-900">${e.qualification_title}</td>
      <td class="p-3"><span class="px-2 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-bold">${e.qualification_level}</span></td>
      <td class="p-3 text-slate-600">${e.class_or_gpa || '-'}</td>
      <td class="p-3 text-slate-600">${e.graduation_year}</td>
      <td class="p-3"><span class="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-bold"><i class="fa-solid fa-check"></i> VERIFIED</span></td>
    </tr>
  `).join('');
}

function renderSchoolEdTable(records) {
  const tbody = document.getElementById('table-school-education');
  if (!tbody) return;

  if (records.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="p-4 text-center text-slate-400">No primary or secondary school records.</td></tr>`;
    return;
  }

  tbody.innerHTML = records.map(s => `
    <tr class="hover:bg-slate-50 transition">
      <td class="p-3 font-semibold text-slate-900">${s.school_name}</td>
      <td class="p-3 font-mono text-slate-500">${s.admission_number || '-'}</td>
      <td class="p-3 text-slate-600">${s.start_year} - ${s.end_year || 'Present'}</td>
      <td class="p-3 font-semibold text-slate-700">${s.highest_grade_passed || '-'}</td>
      <td class="p-3 text-slate-600">${s.conduct_remarks || '-'}</td>
    </tr>
  `).join('');
}

function renderExamResultsTable(records) {
  const tbody = document.getElementById('table-exam-results');
  if (!tbody) return;

  if (records.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="p-4 text-center text-slate-400">No national examination results documented.</td></tr>`;
    return;
  }

  tbody.innerHTML = records.map(r => `
    <tr class="hover:bg-slate-50 transition">
      <td class="p-3 font-semibold text-slate-900">${r.exam_name}</td>
      <td class="p-3 font-mono text-slate-500">${r.exam_index_number}</td>
      <td class="p-3 text-slate-600">${r.exam_year}</td>
      <td class="p-3 text-slate-800">${r.subject}</td>
      <td class="p-3 font-extrabold text-sky-700">${r.grade}</td>
    </tr>
  `).join('');
}

function renderPassportsList(passports) {
  const container = document.getElementById('passports-card-list');
  if (!container) return;

  if (passports.length === 0) {
    container.innerHTML = `<p class="text-xs text-slate-400">No active passport credentials recorded.</p>`;
    return;
  }

  container.innerHTML = passports.map(p => `
    <div class="p-4 rounded-xl bg-white border border-slate-200 shadow-sm flex justify-between items-center">
      <div>
        <span class="text-[10px] uppercase font-bold text-slate-400 block">${p.issue_country || 'SRI LANKA'} PASSPORT</span>
        <span class="text-base font-mono font-bold text-slate-900">${p.passport_number}</span>
        <div class="text-[11px] text-slate-500 mt-1">
          Valid: ${p.issue_date} &bull; Expires: ${p.expiry_date}
        </div>
      </div>
      <div>
        <span class="px-2.5 py-1 rounded-full text-xs font-bold ${p.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}">
          ${p.status}
        </span>
      </div>
    </div>
  `).join('');
}

function renderLicencesList(licences) {
  const container = document.getElementById('licences-card-list');
  if (!container) return;

  if (licences.length === 0) {
    container.innerHTML = `<p class="text-xs text-slate-400">No motor driving licence recorded.</p>`;
    return;
  }

  container.innerHTML = licences.map(l => `
    <div class="p-4 rounded-xl bg-white border border-slate-200 shadow-sm flex justify-between items-center">
      <div>
        <span class="text-[10px] uppercase font-bold text-slate-400 block">NATIONAL DRIVING LICENCE</span>
        <span class="text-base font-mono font-bold text-slate-900">${l.licence_number}</span>
        <div class="text-[11px] text-slate-500 mt-1">
          Vehicle Classes: <strong class="text-slate-800">${l.vehicle_classes}</strong>
        </div>
        <div class="text-[11px] text-slate-400">Demerit Points: ${l.demerit_points || 0}</div>
      </div>
      <div>
        <span class="px-2.5 py-1 rounded-full text-xs font-bold ${l.status === 'VALID' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}">
          ${l.status}
        </span>
      </div>
    </div>
  `).join('');
}

function renderCivilStatus(births, marriages) {
  const bDiv = document.getElementById('birth-registration-display');
  const mDiv = document.getElementById('marriage-registration-display');

  if (bDiv) {
    if (births.length === 0) {
      bDiv.innerHTML = '<p class="text-slate-400">No birth registration details on file.</p>';
    } else {
      const b = births[0];
      bDiv.innerHTML = `
        <div class="p-4 bg-gradient-to-r from-amber-50 to-white rounded-xl border border-amber-300 space-y-3">
          <div class="flex flex-wrap items-center justify-between gap-2 border-b border-amber-200 pb-2">
            <span class="font-black text-[#8D153A] flex items-center gap-1.5 text-xs sm:text-sm">
              <i class="fa-solid fa-stamp text-amber-600"></i> Sri Lankan Civil Birth Certificate (උප්පැන්න සහතිකය)
            </span>
            <span class="font-mono font-bold text-xs bg-white px-2.5 py-0.5 rounded border border-amber-300 text-slate-800 shadow-sm">
              ${b.registration_number}
            </span>
          </div>
          
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            <div><strong class="text-slate-700">Place of Birth:</strong> <span class="font-bold text-slate-900">${b.place_of_birth}</span></div>
            <div><strong class="text-slate-700">Hospital / Facility:</strong> <span class="font-bold text-slate-900">${b.hospital_name || 'Government Maternity Hospital'}</span></div>
            <div><strong class="text-slate-700">Attending Doctor:</strong> <span class="font-bold text-slate-900">${b.attending_physician || 'Chief Medical Officer'}</span></div>
            <div><strong class="text-slate-700">Registration Date:</strong> <span class="font-bold text-slate-900">${b.date_of_registration}</span></div>
          </div>

          ${(b.father_name || b.display_father_name || b.mother_name || b.display_mother_name) ? `
            <div class="pt-2 border-t border-amber-200 space-y-1.5">
              <div class="font-black text-[11px] uppercase tracking-wide text-emerald-950 flex items-center gap-1.5">
                <i class="fa-solid fa-people-roof text-emerald-700"></i> Certified Parents' Particulars (දෙමාපියන්ගේ විස්තර):
              </div>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 bg-white/90 p-2.5 rounded-lg border border-amber-200 text-xs">
                <div>
                  <span class="text-slate-500 font-extrabold block text-[10px] uppercase">Father / පියා:</span>
                  <div class="font-black text-slate-900">${b.father_name || b.display_father_name || 'Not Recorded'}</div>
                  ${(b.father_nic || b.display_father_nic) ? `<div class="text-[11px] text-slate-600 font-semibold">NIC: <span class="font-mono text-slate-900">${b.father_nic || b.display_father_nic}</span></div>` : ''}
                  ${(b.father_phone || b.display_father_phone) ? `<div class="text-[11px] text-slate-600 font-semibold">Phone: ${b.father_phone || b.display_father_phone}</div>` : ''}
                </div>
                <div>
                  <span class="text-slate-500 font-extrabold block text-[10px] uppercase">Mother / මව:</span>
                  <div class="font-black text-slate-900">${b.mother_name || b.display_mother_name || 'Not Recorded'}</div>
                  ${(b.mother_nic || b.display_mother_nic) ? `<div class="text-[11px] text-slate-600 font-semibold">NIC: <span class="font-mono text-slate-900">${b.mother_nic || b.display_mother_nic}</span></div>` : ''}
                  ${(b.mother_phone || b.display_mother_phone) ? `<div class="text-[11px] text-slate-600 font-semibold">Phone: ${b.mother_phone || b.display_mother_phone}</div>` : ''}
                </div>
              </div>
              ${b.informant_name ? `<div class="text-[11px] text-slate-600"><strong>Informant:</strong> ${b.informant_name}</div>` : ''}
            </div>
          ` : ''}
        </div>
      `;
    }
  }

  if (mDiv) {
    if (marriages.length === 0) {
      mDiv.innerHTML = '<p class="text-slate-400">Civil status: Single / No marriage recorded.</p>';
    } else {
      const m = marriages[0];
      mDiv.innerHTML = `
        <div class="font-bold text-slate-900">Marriage Certificate: ${m.certificate_number}</div>
        <div>Date of Marriage: ${m.marriage_date}</div>
        <div>Registry Office: ${m.registration_place}</div>
        <div>Status: <span class="text-emerald-700 font-bold">${m.status}</span></div>
      `;
    }
  }
}

/* ==========================================================================
   FORM SUBMISSIONS: DIAGNOSIS, EDUCATION, BIRTH REGISTRATION, UPLOAD
   ========================================================================== */

async function handleAddDiagnosis(e) {
  e.preventDefault();
  const citizen_id = document.getElementById('diag-citizen-id').value.trim();
  const diagnosed_condition = document.getElementById('diag-condition').value.trim();
  const hospital_name = document.getElementById('diag-hospital').value.trim();
  const treating_physician = document.getElementById('diag-physician').value.trim();
  const diagnosis_date = document.getElementById('diag-date').value;
  const chronic_flag = document.getElementById('diag-chronic').checked;
  const allergies = document.getElementById('diag-allergies').value.trim();
  const notes = document.getElementById('diag-notes').value.trim();

  try {
    await apiRequest('/medical/add', {
      method: 'POST',
      body: {
        citizen_id,
        diagnosed_condition,
        hospital_name,
        treating_physician,
        diagnosis_date,
        chronic_flag,
        allergies,
        notes
      }
    });

    showToast('Clinical diagnosis successfully logged.', 'success');
    e.target.reset();
    switchView('view-medical');
    loadCitizenData(citizen_id);
  } catch (error) {
    showToast(error.message || 'Failed to add diagnosis.', 'error');
  }
}

async function handleAddEducation(e) {
  e.preventDefault();
  const citizen_id = document.getElementById('edu-citizen-id').value.trim();
  const institution_name = document.getElementById('edu-institution').value.trim();
  const qualification_level = document.getElementById('edu-level').value;
  const qualification_title = document.getElementById('edu-title').value.trim();
  const class_or_gpa = document.getElementById('edu-gpa').value.trim();
  const graduation_year = document.getElementById('edu-year').value;

  try {
    await apiRequest('/education/add', {
      method: 'POST',
      body: {
        citizen_id,
        type: 'HIGHER',
        institution_name,
        qualification_level,
        qualification_title,
        class_or_gpa,
        graduation_year
      }
    });

    showToast('Academic credential successfully registered.', 'success');
    e.target.reset();
    switchView('view-education');
    loadCitizenData(citizen_id);
  } catch (error) {
    showToast(error.message || 'Failed to add education record.', 'error');
  }
}

// ============================================================================
// CITIZEN RECORD MANAGEMENT HANDLERS (Passports, Driving Licences, Marriages, Births)
// ============================================================================

function openAddPassportModal() {
  const modal = document.getElementById('modal-add-passport');
  if (!modal) return;
  const citInput = document.getElementById('pass-citizen-id');
  if (citInput && state.currentCitizenId) {
    citInput.value = state.currentCitizenId;
    if (state.user?.role_name === 'CITIZEN') {
      citInput.readOnly = true;
    }
  }
  modal.classList.remove('hidden');
}

function closeAddPassportModal() {
  const modal = document.getElementById('modal-add-passport');
  if (modal) modal.classList.add('hidden');
}

async function handleAddPassportSubmit(e) {
  e.preventDefault();
  const citizen_id = document.getElementById('pass-citizen-id')?.value.trim();
  const passport_number = document.getElementById('pass-number')?.value.trim();
  const issue_country = document.getElementById('pass-country')?.value.trim() || 'SRI LANKA';
  const issue_date = document.getElementById('pass-issue-date')?.value;
  const expiry_date = document.getElementById('pass-expiry-date')?.value;
  const status = document.getElementById('pass-status')?.value || 'ACTIVE';

  try {
    await apiRequest('/passport/add', {
      method: 'POST',
      body: {
        citizen_id,
        passport_number,
        issue_country,
        issue_date,
        expiry_date,
        status
      }
    });

    showToast('Passport details recorded successfully.', 'success');
    closeAddPassportModal();
    e.target.reset();
    if (state.currentCitizenId) {
      loadCitizenData(state.currentCitizenId);
    }
  } catch (error) {
    showToast(error.message || 'Failed to record passport details.', 'error');
  }
}

function openAddLicenceModal() {
  const modal = document.getElementById('modal-add-licence');
  if (!modal) return;
  const citInput = document.getElementById('lic-citizen-id');
  if (citInput && state.currentCitizenId) {
    citInput.value = state.currentCitizenId;
    if (state.user?.role_name === 'CITIZEN') {
      citInput.readOnly = true;
    }
  }
  modal.classList.remove('hidden');
}

function closeAddLicenceModal() {
  const modal = document.getElementById('modal-add-licence');
  if (modal) modal.classList.add('hidden');
}

async function handleAddLicenceSubmit(e) {
  e.preventDefault();
  const citizen_id = document.getElementById('lic-citizen-id')?.value.trim();
  const licence_number = document.getElementById('lic-number')?.value.trim();
  const vehicle_classes = document.getElementById('lic-classes')?.value.trim();
  const issue_date = document.getElementById('lic-issue-date')?.value;
  const expiry_date = document.getElementById('lic-expiry-date')?.value;
  const demerit_points = parseInt(document.getElementById('lic-demerit-points')?.value || 0, 10);
  const status = document.getElementById('lic-status')?.value || 'VALID';

  try {
    await apiRequest('/licence/add', {
      method: 'POST',
      body: {
        citizen_id,
        licence_number,
        vehicle_classes,
        issue_date,
        expiry_date,
        demerit_points,
        status
      }
    });

    showToast('Driving licence details recorded successfully.', 'success');
    closeAddLicenceModal();
    e.target.reset();
    if (state.currentCitizenId) {
      loadCitizenData(state.currentCitizenId);
    }
  } catch (error) {
    showToast(error.message || 'Failed to record driving licence details.', 'error');
  }
}

function openAddMarriageModal() {
  const modal = document.getElementById('modal-add-marriage');
  if (!modal) return;
  const citInput = document.getElementById('marriage-spouse-one-id');
  if (citInput && state.currentCitizenId) {
    citInput.value = state.currentCitizenId;
    if (state.user?.role_name === 'CITIZEN') {
      citInput.readOnly = true;
    }
  }
  modal.classList.remove('hidden');
}

function closeAddMarriageModal() {
  const modal = document.getElementById('modal-add-marriage');
  if (modal) modal.classList.add('hidden');
}

async function handleAddMarriageSubmit(e) {
  e.preventDefault();
  const spouse_one_id = document.getElementById('marriage-spouse-one-id')?.value.trim();
  const spouse_two_id = document.getElementById('marriage-spouse-two-id')?.value.trim();
  const certificate_number = document.getElementById('marriage-certificate-no')?.value.trim();
  const marriage_date = document.getElementById('marriage-date')?.value;
  const registration_place = document.getElementById('marriage-place')?.value.trim();
  const status = document.getElementById('marriage-status')?.value || 'ACTIVE';

  try {
    await apiRequest('/vital/marriage/add', {
      method: 'POST',
      body: {
        spouse_one_id,
        spouse_two_id,
        certificate_number,
        marriage_date,
        registration_place,
        status
      }
    });

    showToast('Civil marriage record recorded successfully.', 'success');
    closeAddMarriageModal();
    e.target.reset();
    if (state.currentCitizenId) {
      loadCitizenData(state.currentCitizenId);
    }
  } catch (error) {
    showToast(error.message || 'Failed to record marriage details.', 'error');
  }
}

function openAddVitalBirth() {
  switchView('view-registrar-birth');
  if (state.currentCitizenId) {
    const cit = state.currentCitizen;
    if (cit && cit.gender === 'FEMALE') {
      const mInput = document.getElementById('birth-mother-id');
      if (mInput) mInput.value = state.currentCitizenId;
    } else {
      const fInput = document.getElementById('birth-father-id');
      if (fInput) fInput.value = state.currentCitizenId;
    }
  }
}

/**
 * Client-Side Legal Name Validator
 * Prevents hallucinated, test, or synthetic names before API submission
 */
function validateLegalName(name, fieldName = 'Name') {
  if (!name || typeof name !== 'string') {
    return { valid: false, message: `${fieldName} is required.` };
  }
  const trimmed = name.trim();
  if (trimmed.length < 2) {
    return { valid: false, message: `${fieldName} must be at least 2 characters long.` };
  }
  if (trimmed.length > 60) {
    return { valid: false, message: `${fieldName} cannot exceed 60 characters.` };
  }
  if (!/^[a-zA-Z\s\.\'\-]+$/.test(trimmed)) {
    return { valid: false, message: `${fieldName} contains invalid characters. Only letters, spaces, hyphens, and apostrophes are allowed.` };
  }
  const prohibited = [
    'test', 'dummy', 'fake', 'sample', 'hallucination', 'hallucinated',
    'placeholder', 'unknown', 'anonymous', 'none', 'null', 'undefined',
    'asdf', 'qwerty', 'tester', 'demo', 'mock', 'fake name', 'no name',
    'john doe', 'jane doe', 'foo', 'bar', 'baz'
  ];
  const lower = trimmed.toLowerCase();
  for (const token of prohibited) {
    const words = lower.split(/[\s\.\'\-]+/);
    if (words.includes(token) || lower === token) {
      return { valid: false, message: `${fieldName} cannot contain placeholder, mock, or synthetic test names ("${token}"). Please enter genuine legal birth record names.` };
    }
  }
  if (/(.)\1{3,}/.test(lower)) {
    return { valid: false, message: `${fieldName} contains repetitive characters. Please enter a valid legal name.` };
  }
  return { valid: true };
}

async function handleRegisterBirth(e) {
  e.preventDefault();
  const firstInput = document.getElementById('birth-first-name');
  const middleInput = document.getElementById('birth-middle-names');
  const lastInput = document.getElementById('birth-last-name');
  const submitBtn = document.getElementById('btn-submit-birth');

  const first_name = firstInput ? firstInput.value.trim() : '';
  const middle_names = middleInput ? middleInput.value.trim() : '';
  const last_name = lastInput ? lastInput.value.trim() : '';
  const date_of_birth = document.getElementById('birth-dob').value;
  const gender = document.getElementById('birth-gender').value;
  const blood_group = document.getElementById('birth-blood').value;
  const place_of_birth = document.getElementById('birth-place').value.trim();
  const hospital_name = document.getElementById('birth-hospital').value.trim();
  const mother_citizen_id = document.getElementById('birth-mother-id').value.trim() || null;
  const father_citizen_id = document.getElementById('birth-father-id').value.trim() || null;
  const informant_name = document.getElementById('birth-informant').value.trim();

  // Strict Client-Side Anti-Hallucination Name Validation
  const valFirst = validateLegalName(first_name, 'First Name');
  if (!valFirst.valid) {
    showToast(valFirst.message, 'error');
    if (firstInput) firstInput.focus();
    return;
  }

  if (middle_names) {
    const valMiddle = validateLegalName(middle_names, 'Middle Names');
    if (!valMiddle.valid) {
      showToast(valMiddle.message, 'error');
      if (middleInput) middleInput.focus();
      return;
    }
  }

  const valLast = validateLegalName(last_name, 'Last Name / Surname');
  if (!valLast.valid) {
    showToast(valLast.message, 'error');
    if (lastInput) lastInput.focus();
    return;
  }

  if (informant_name) {
    const cleanInformant = informant_name.split('(')[0].trim();
    const valInformant = validateLegalName(cleanInformant, 'Informant Name');
    if (!valInformant.valid) {
      showToast(valInformant.message, 'error');
      return;
    }
  }

  // Parent ID / NIC Format Validation (if provided): Accepts LK-YYYYMMDD-XXXX or 9/12-digit NIC
  const parentIdPattern = /^(LK-\d{8}-\d{4}|\d{9}[vVxX]|\d{12})$/;
  if (mother_citizen_id && !parentIdPattern.test(mother_citizen_id)) {
    showToast("Mother's ID must be a valid Citizen ID or National NIC", 'error');
    return;
  }
  if (father_citizen_id && !parentIdPattern.test(father_citizen_id)) {
    showToast("Father's ID must be a valid Citizen ID or National NIC", 'error');
    return;
  }

  // Loading state
  const originalBtnContent = submitBtn ? submitBtn.innerHTML : '';
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Processing Official Registration...';
  }

  try {
    const res = await apiRequest('/vital/register-birth', {
      method: 'POST',
      body: {
        first_name,
        middle_names,
        last_name,
        date_of_birth,
        gender,
        blood_group,
        place_of_birth,
        hospital_name,
        mother_citizen_id,
        father_citizen_id,
        informant_name
      }
    });

    const c = res.data;
    const form = document.getElementById('form-register-birth');
    if (form) form.reset();

    const resultDiv = document.getElementById('new-birth-result-container');
    if (resultDiv) {
      resultDiv.innerHTML = `
        <div class="p-6 rounded-2xl bg-gradient-to-b from-emerald-50 to-white border-2 border-emerald-400 shadow-lg text-slate-800 animate-in fade-in zoom-in-95 duration-300">
          <div class="flex items-center justify-between border-b border-emerald-200 pb-4 mb-4">
            <div class="flex items-center gap-3">
              <div class="w-12 h-12 rounded-xl bg-emerald-600 text-white flex items-center justify-center text-2xl shadow-md shadow-emerald-600/30">
                <i class="fa-solid fa-stamp"></i>
              </div>
              <div>
                <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold uppercase tracking-wider mb-1">
                  <i class="fa-solid fa-circle-check text-emerald-600"></i> Civil Status Validated & Sealed
                </span>
                <h3 class="text-lg sm:text-xl font-extrabold text-slate-900 leading-tight">
                  Completed / Successfully created the birth information registration
                </h3>
              </div>
            </div>
            <button onclick="window.print()" class="hidden sm:flex items-center gap-1.5 text-xs text-emerald-800 hover:text-emerald-950 font-bold bg-emerald-100/70 hover:bg-emerald-200 px-3 py-1.5 rounded-lg transition" title="Print Certificate">
              <i class="fa-solid fa-print"></i> Print
            </button>
          </div>

          <p class="text-xs text-slate-600 mb-5">
            The newborn child has been officially registered in the National Civil Registry. A permanent citizen identifier and cryptographic verification token have been issued atomically.
          </p>

          <!-- Core Certificate Credential Grid -->
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3.5 mb-5 text-xs">
            <div class="p-3.5 bg-white rounded-xl border border-emerald-200/80 shadow-sm">
              <span class="text-[10px] text-slate-400 block font-bold uppercase tracking-wider">Registered Child Full Name</span>
              <span class="font-bold text-slate-900 text-base">${c.full_name}</span>
            </div>
            <div class="p-3.5 bg-white rounded-xl border border-emerald-200/80 shadow-sm">
              <span class="text-[10px] text-slate-400 block font-bold uppercase tracking-wider">Allocated National Citizen ID</span>
              <span class="font-mono font-extrabold text-emerald-700 text-base">${c.citizen_id}</span>
            </div>
            <div class="p-3.5 bg-white rounded-xl border border-slate-200 shadow-sm">
              <span class="text-[10px] text-slate-400 block font-bold uppercase tracking-wider">Birth Registration Number</span>
              <span class="font-mono font-bold text-slate-900 text-sm">${c.registration_number}</span>
            </div>
            <div class="p-3.5 bg-white rounded-xl border border-slate-200 shadow-sm">
              <span class="text-[10px] text-slate-400 block font-bold uppercase tracking-wider">Date of Birth & Gender</span>
              <span class="font-medium text-slate-800 text-sm">${c.date_of_birth} &bull; <span class="font-bold text-emerald-700">${c.gender}</span> (${c.blood_group || 'O+'})</span>
            </div>
            <div class="p-3.5 bg-white rounded-xl border border-slate-200 shadow-sm">
              <span class="text-[10px] text-slate-400 block font-bold uppercase tracking-wider">Place of Birth / Facility</span>
              <span class="font-medium text-slate-800 text-xs">${c.place_of_birth} ${c.hospital_name && c.hospital_name !== 'N/A' ? '&bull; ' + c.hospital_name : ''}</span>
            </div>
            <div class="p-3.5 bg-white rounded-xl border border-slate-200 shadow-sm">
              <span class="text-[10px] text-slate-400 block font-bold uppercase tracking-wider">Verified Parentage</span>
              <span class="font-mono text-xs text-slate-700 block">Mother: ${c.mother_citizen_id || 'Not Recorded'}</span>
              <span class="font-mono text-xs text-slate-700 block">Father: ${c.father_citizen_id || 'Not Recorded'}</span>
            </div>
          </div>

          <!-- Cryptographic Token & Visual QR -->
          <div class="p-4 bg-slate-900 text-white rounded-xl mb-5 flex flex-col sm:flex-row items-center gap-4">
            <div id="new-birth-qr-canvas" class="bg-white p-2 rounded-lg shrink-0"></div>
            <div class="flex-1 text-center sm:text-left overflow-hidden">
              <span class="text-[10px] uppercase font-bold text-emerald-400 tracking-wider block mb-1">Cryptographic QR Verification Token</span>
              <span class="font-mono text-[11px] text-slate-300 break-all block mb-2 select-all">${c.qr_token}</span>
              <span class="text-[11px] text-slate-400 block">Scan using public verification portal to validate official identity authenticity without accessing restricted medical or police records.</span>
            </div>
          </div>

          <!-- Actions -->
          <div class="flex flex-wrap items-center justify-between gap-3 pt-2">
            <button onclick="document.getElementById('new-birth-result-container').classList.add('hidden'); document.getElementById('birth-first-name').focus();" 
                    class="bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold px-4 py-2.5 rounded-lg text-xs transition flex items-center gap-2">
              <i class="fa-solid fa-plus"></i> Register Another Child Birth
            </button>
            <button onclick="loadCitizenData('${c.citizen_id}'); switchView('view-citizen-card');" 
                    class="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-5 py-2.5 rounded-lg text-xs shadow-md shadow-emerald-600/20 transition flex items-center gap-2">
              <i class="fa-solid fa-id-card"></i> View Issued Digital National Card &rarr;
            </button>
          </div>
        </div>
      `;
      resultDiv.classList.remove('hidden');

      // Generate visual QR code into the canvas container
      const qrContainer = document.getElementById('new-birth-qr-canvas');
      if (qrContainer && typeof QRCode !== 'undefined') {
        qrContainer.innerHTML = '';
        new QRCode(qrContainer, {
          text: c.qr_token,
          width: 90,
          height: 90,
          colorDark: '#0f172a',
          colorLight: '#ffffff',
          correctLevel: QRCode.CorrectLevel.M
        });
      }

      // Smoothly scroll to the success confirmation
      resultDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    showToast(`Completed / Successfully created the birth information registration! Citizen ID: ${c.citizen_id}`, 'success');
  } catch (error) {
    showToast(error.message || 'Failed to register birth.', 'error');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalBtnContent;
    }
  }
}

/**
 * Document Upload & Storage Handler
 */
async function handleDocumentUpload(e) {
  e.preventDefault();
  const citizen_id = document.getElementById('upload-citizen-id').value.trim();
  const module_category = document.getElementById('upload-category').value;
  const document_title = document.getElementById('upload-title').value.trim();
  const fileInput = document.getElementById('upload-file-input');
  const btn = document.getElementById('btn-upload-submit');

  if (!fileInput.files || fileInput.files.length === 0) {
    showToast('Please select a file to upload.', 'error');
    return;
  }

  const formData = new FormData();
  formData.append('citizen_id', citizen_id);
  formData.append('module_category', module_category);
  formData.append('document_title', document_title);
  formData.append('file', fileInput.files[0]);

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Uploading...`;
  }

  try {
    await apiRequest('/documents/upload', {
      method: 'POST',
      body: formData
    });

    showToast('Document uploaded successfully.', 'success');
    e.target.reset();
    document.getElementById('upload-citizen-id').value = citizen_id;
    loadCitizenDocuments(citizen_id);
  } catch (error) {
    showToast(error.message || 'Failed to upload document.', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<i class="fa-solid fa-cloud-arrow-up"></i> Upload Document`;
    }
  }
}

async function loadCitizenDocuments(citizenId) {
  const tbody = document.getElementById('table-documents-list');
  if (!tbody || !citizenId) return;

  try {
    const res = await apiRequest(`/documents/${citizenId}`);
    const docs = res.data || [];

    if (docs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-slate-400">No stored documents found for this citizen.</td></tr>`;
      return;
    }

    tbody.innerHTML = docs.map(d => `
      <tr class="hover:bg-slate-50 transition">
        <td class="p-3 font-semibold text-slate-900">${d.document_title}</td>
        <td class="p-3"><span class="px-2 py-0.5 rounded text-[10px] font-bold bg-sky-100 text-sky-800">${d.module_category}</span></td>
        <td class="p-3 text-slate-500 font-mono text-[11px]">${d.file_mime_type}</td>
        <td class="p-3 text-slate-500">${new Date(d.uploaded_at).toLocaleDateString()}</td>
        <td class="p-3 text-slate-600">${d.uploaded_by || 'Officer'}</td>
        <td class="p-3 text-right">
          <div class="inline-flex items-center justify-end gap-1.5">
            <a href="/api/documents/file/${d.doc_id}" target="_blank" class="px-2.5 py-1 bg-sky-600 hover:bg-sky-500 text-white rounded text-[11px] font-semibold transition" title="View / Download Document">
              <i class="fa-solid fa-arrow-down"></i> View
            </a>
            ${((state.user?.role_name || '').toUpperCase() === 'ADMIN') ? `
            <button onclick="handleDeleteDocument(${d.doc_id}, '${(d.document_title || '').replace(/'/g, "\\'")}')" class="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 rounded text-[11px] font-semibold transition" title="Delete document">
              <i class="fa-solid fa-trash-can"></i>
            </button>` : ''}
          </div>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-rose-500">Failed to load documents: ${err.message}</td></tr>`;
  }
}

/* ==========================================================================
   ADMIN AUDIT LOGS VIEW
   ========================================================================== */

let debounceTimer = null;
function debounceAuditSearch() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    state.auditPagination.page = 1;
    loadAdminAuditLogs();
  }, 400);
}

async function loadAdminAuditLogs() {
  if (state.user.role_name !== 'ADMIN') return;

  const tbody = document.getElementById('table-audit-logs');
  const actionFilter = document.getElementById('audit-filter-action')?.value || '';
  const moduleFilter = document.getElementById('audit-filter-module')?.value.trim() || '';
  const citizenFilter = document.getElementById('audit-filter-citizen')?.value.trim() || '';

  const queryParams = new URLSearchParams({
    page: state.auditPagination.page,
    limit: state.auditPagination.limit
  });

  if (actionFilter) queryParams.append('action_type', actionFilter);
  if (moduleFilter) queryParams.append('module_accessed', moduleFilter);
  if (citizenFilter) queryParams.append('target_citizen_id', citizenFilter);

  try {
    const res = await apiRequest(`/audit/logs?${queryParams.toString()}`);
    const logs = res.data || [];
    const p = res.pagination || {};

    state.auditPagination.total = p.total || 0;
    state.auditPagination.totalPages = p.total_pages || 1;

    setElementText('audit-total-count', p.total);
    setElementText('audit-current-page', p.page);
    setElementText('audit-total-pages', p.total_pages);

    const prevBtn = document.getElementById('btn-audit-prev');
    const nextBtn = document.getElementById('btn-audit-next');
    if (prevBtn) prevBtn.disabled = p.page <= 1;
    if (nextBtn) nextBtn.disabled = p.page >= p.total_pages;

    if (tbody) {
      if (logs.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-slate-400 font-sans">No audit events match filters.</td></tr>`;
        return;
      }

      tbody.innerHTML = logs.map(l => `
        <tr class="hover:bg-slate-50 transition text-[11px]">
          <td class="p-3 text-slate-400">#${l.log_id}</td>
          <td class="p-3 text-slate-600">${new Date(l.timestamp).toLocaleString()}</td>
          <td class="p-3 font-semibold text-slate-800">${l.username || 'user_' + l.user_id} (${l.role_name || 'N/A'})</td>
          <td class="p-3 font-bold ${getActionColor(l.action_type)}">${l.action_type}</td>
          <td class="p-3 text-sky-800 font-medium">${l.module_accessed}</td>
          <td class="p-3 font-mono text-slate-700">${l.target_citizen_id || '-'}</td>
          <td class="p-3 text-slate-500">${l.ip_address}</td>
        </tr>
      `).join('');
    }
  } catch (err) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-rose-500 font-sans">Error: ${err.message}</td></tr>`;
  }
}

function getActionColor(act) {
  switch (act) {
    case 'CREATE': return 'text-emerald-600';
    case 'UPDATE': return 'text-amber-600';
    case 'DELETE': return 'text-rose-600';
    case 'EXPORT': return 'text-purple-600';
    default: return 'text-slate-700';
  }
}

function changeAuditPage(direction) {
  state.auditPagination.page = Math.max(1, state.auditPagination.page + direction);
  loadAdminAuditLogs();
}

/* ==========================================================================
   ADMIN NATIONAL CORE REGISTRY & DELETION CONTROLLER (VIEW & DELETE)
   ========================================================================== */

let adminRegistryDebounceTimer = null;

/**
 * Set Master Admin Console Mode: 'VIEW' (Option 1) vs 'DELETE' (Option 2)
 */
function setAdminConsoleMode(mode) {
  state.adminRegistry.mode = mode || 'VIEW';
  state.adminRegistry.page = 1;

  const btnView = document.getElementById('btn-admin-mode-view');
  const btnDelete = document.getElementById('btn-admin-mode-delete');
  const bannerView = document.getElementById('admin-banner-view');
  const bannerDelete = document.getElementById('admin-banner-delete');

  if (state.adminRegistry.mode === 'VIEW') {
    if (btnView) {
      btnView.className = 'px-4 py-2.5 rounded-xl text-xs font-black transition flex items-center gap-2 bg-[#8D153A] text-white shadow-sm';
    }
    if (btnDelete) {
      btnDelete.className = 'px-4 py-2.5 rounded-xl text-xs font-black transition flex items-center gap-2 bg-white text-rose-800 border border-rose-300 hover:bg-rose-50';
    }
    if (bannerView) bannerView.classList.remove('hidden');
    if (bannerDelete) bannerDelete.classList.add('hidden');
  } else {
    if (btnView) {
      btnView.className = 'px-4 py-2.5 rounded-xl text-xs font-black transition flex items-center gap-2 bg-white text-slate-700 hover:bg-slate-200 border border-slate-300';
    }
    if (btnDelete) {
      btnDelete.className = 'px-4 py-2.5 rounded-xl text-xs font-black transition flex items-center gap-2 bg-rose-600 text-white shadow-md ring-2 ring-rose-400';
    }
    if (bannerView) bannerView.classList.add('hidden');
    if (bannerDelete) bannerDelete.classList.remove('hidden');
  }

  updateAdminSectorButtonsUI();
  loadAdminRegistryData();
}

/**
 * Open Option 1: View Sector Details
 */
function openAdminSectorView(sector) {
  state.adminRegistry.mode = 'VIEW';
  state.adminRegistry.sector = sector;
  state.adminRegistry.page = 1;
  state.adminRegistry.search = '';
  const searchInput = document.getElementById('admin-registry-search');
  if (searchInput) searchInput.value = '';

  switchView('view-admin-registry');
  setAdminConsoleMode('VIEW');
}

/**
 * Open Option 2: Delete Sector Records
 */
function openAdminSectorDelete(sector) {
  state.adminRegistry.mode = 'DELETE';
  state.adminRegistry.sector = sector;
  state.adminRegistry.page = 1;
  state.adminRegistry.search = '';
  const searchInput = document.getElementById('admin-registry-search');
  if (searchInput) searchInput.value = '';

  switchView('view-admin-registry');
  setAdminConsoleMode('DELETE');
}

/**
 * Switch Active Sector in Current Mode
 */
function switchAdminSector(sector) {
  state.adminRegistry.sector = sector;
  state.adminRegistry.page = 1;
  state.adminRegistry.search = '';
  const searchInput = document.getElementById('admin-registry-search');
  if (searchInput) searchInput.value = '';

  updateAdminSectorButtonsUI();
  loadAdminRegistryData();
}

/**
 * Sync Sector Switcher Buttons, Stats, and Sidebar to Active Mode and Sector
 */
function updateAdminSectorButtonsUI() {
  const sector = state.adminRegistry.sector;
  const mode = state.adminRegistry.mode;
  const sectors = ['citizens', 'school', 'hospital', 'university', 'police', 'immigration', 'registrar'];

  // 1. Update Sector Bar Title
  const titleEl = document.getElementById('admin-sector-bar-title');
  if (titleEl) {
    if (mode === 'VIEW') {
      titleEl.innerHTML = `<i class="fa-solid fa-eye text-[#8D153A] mr-1"></i> Option 1: Select Sector to View Details:`;
    } else {
      titleEl.innerHTML = `<i class="fa-solid fa-trash-can text-rose-600 mr-1"></i> Option 2: Select Sector to Delete Records:`;
    }
  }

  // 2. Update Sector Switcher Buttons
  const displayNames = {
    citizens: 'Citizens',
    school: 'School',
    hospital: 'Hospital',
    university: 'University',
    police: 'Police',
    immigration: 'Immigration',
    registrar: 'Registrar'
  };

  sectors.forEach(s => {
    const btn = document.getElementById(`btn-sec-${s}`);
    const labelSpan = document.getElementById(`label-sec-${s}`);
    if (labelSpan) {
      labelSpan.textContent = mode === 'VIEW' ? `View ${displayNames[s]}` : `Delete ${displayNames[s]}`;
    }

    if (btn) {
      if (s === sector) {
        if (mode === 'VIEW') {
          btn.className = 'admin-sec-btn px-3.5 py-2 rounded-xl text-xs font-black transition flex items-center gap-1.5 bg-[#8D153A] text-white shadow-sm';
        } else {
          btn.className = 'admin-sec-btn px-3.5 py-2 rounded-xl text-xs font-black transition flex items-center gap-1.5 bg-rose-600 text-white shadow-md ring-2 ring-rose-400';
        }
      } else {
        if (mode === 'VIEW') {
          btn.className = 'admin-sec-btn px-3.5 py-2 rounded-xl text-xs font-black transition flex items-center gap-1.5 bg-white text-slate-700 hover:bg-slate-200 border border-slate-200';
        } else {
          btn.className = 'admin-sec-btn px-3.5 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 bg-rose-50 text-rose-900 border border-rose-200 hover:bg-rose-100';
        }
      }
    }

    // Stat cards highlight
    const card = document.getElementById(`card-stat-${s}`);
    if (card) {
      if (s === sector) {
        card.classList.add('ring-2', mode === 'VIEW' ? 'ring-[#8D153A]' : 'ring-rose-600', 'shadow-sm');
      } else {
        card.classList.remove('ring-2', 'ring-[#8D153A]', 'ring-rose-600', 'shadow-sm');
      }
    }
  });

  // 3. Update sector badge
  const badgeEl = document.getElementById('admin-sector-badge');
  if (badgeEl) {
    const labels = {
      citizens: 'All Citizens Master Registry',
      school: 'Primary & Secondary Education',
      hospital: 'Hospital & Healthcare Records',
      university: 'Higher Education & Universities',
      police: 'Police & Traffic Driving Licences',
      immigration: 'Immigration & Passports',
      registrar: 'Registrar Civil & Vital Births'
    };
    badgeEl.textContent = `${mode === 'VIEW' ? 'VIEWING' : 'DELETING'}: ${labels[sector] || sector.toUpperCase()}`;
    if (mode === 'VIEW') {
      badgeEl.className = 'px-2.5 py-1 bg-rose-50 text-[#8D153A] rounded-lg border border-rose-200 font-bold uppercase text-[10px]';
    } else {
      badgeEl.className = 'px-2.5 py-1 bg-rose-100 text-rose-800 rounded-lg border border-rose-400 font-black uppercase text-[10px]';
    }
  }

  // 4. Update sidebar active item highlight
  document.querySelectorAll('.nav-item').forEach(b => {
    b.classList.remove('bg-rose-50', 'text-[#8D153A]', 'border-l-4', 'border-[#8D153A]');
  });
  const navId = mode === 'VIEW' ? `nav-view-${sector}` : `nav-delete-${sector}`;
  const sidebarBtn = document.getElementById(navId);
  if (sidebarBtn) {
    sidebarBtn.classList.add('bg-rose-50', 'text-[#8D153A]', 'border-l-4', 'border-[#8D153A]');
  }
}

function debounceAdminRegistrySearch() {
  clearTimeout(adminRegistryDebounceTimer);
  adminRegistryDebounceTimer = setTimeout(() => {
    const input = document.getElementById('admin-registry-search');
    state.adminRegistry.search = input ? input.value.trim() : '';
    state.adminRegistry.page = 1;
    loadAdminRegistryData();
  }, 300);
}

function changeAdminRegistryPage(delta) {
  state.adminRegistry.page = Math.max(1, state.adminRegistry.page + delta);
  loadAdminRegistryData();
}

/**
 * Fetch and populate Sector Registry Data
 */
async function loadAdminRegistryData() {
  if (state.user?.role_name !== 'ADMIN') return;

  const thead = document.getElementById('admin-registry-thead');
  const tbody = document.getElementById('admin-registry-tbody');
  const totalCountEl = document.getElementById('admin-registry-total-count');
  const pageEl = document.getElementById('admin-registry-page');
  const totalPagesEl = document.getElementById('admin-registry-total-pages');
  const prevBtn = document.getElementById('btn-admin-prev');
  const nextBtn = document.getElementById('btn-admin-next');

  const sector = state.adminRegistry.sector;
  const page = state.adminRegistry.page;
  const limit = state.adminRegistry.limit;
  const search = state.adminRegistry.search;
  const mode = state.adminRegistry.mode;

  if (tbody) {
    tbody.innerHTML = `<tr><td colspan="8" class="p-8 text-center text-slate-500 font-bold"><i class="fa-solid fa-spinner fa-spin text-[#8D153A] mr-2"></i> Querying ${sector.toUpperCase()} registry (${mode} MODE)...</td></tr>`;
  }

  // 1. Fetch updated sector summary counts
  try {
    const countRes = await apiRequest('/admin/overview-counts');
    if (countRes.success && countRes.counts) {
      const c = countRes.counts;
      setElementText('count-stat-citizens', c.citizens || 0);
      setElementText('count-stat-hospital', c.hospital || 0);
      setElementText('count-stat-school', c.school || 0);
      setElementText('count-stat-university', c.university || 0);
      setElementText('count-stat-police', c.police || 0);
      setElementText('count-stat-immigration', c.immigration || 0);
      setElementText('count-stat-registrar', c.registrar || 0);
    }
  } catch (err) {
    console.warn('[Overview Counts Warning]', err.message);
  }

  // 2. Fetch sector records
  try {
    const queryParams = new URLSearchParams({ page, limit });
    if (search) queryParams.append('q', search);

    const res = await apiRequest(`/admin/${sector}?${queryParams.toString()}`);
    const rows = res.data || [];
    const p = res.pagination || {};

    state.adminRegistry.total = p.total || 0;
    state.adminRegistry.totalPages = p.total_pages || 1;
    state.adminRegistry.currentRows = rows; // Cache rows for instant details modal lookup

    if (totalCountEl) totalCountEl.textContent = p.total || 0;
    if (pageEl) pageEl.textContent = p.page || 1;
    if (totalPagesEl) totalPagesEl.textContent = p.total_pages || 1;
    if (prevBtn) prevBtn.disabled = p.page <= 1;
    if (nextBtn) nextBtn.disabled = p.page >= p.total_pages;

    renderAdminRegistryTable(sector, rows);
  } catch (err) {
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="8" class="p-6 text-center text-rose-600 font-bold">Failed to load ${sector} records: ${err.message}</td></tr>`;
    }
  }
}

/**
 * Render Data Table tailored to Active Sector and Mode (View vs Delete)
 */
function renderAdminRegistryTable(sector, rows) {
  const thead = document.getElementById('admin-registry-thead');
  const tbody = document.getElementById('admin-registry-tbody');
  const tableContainer = document.getElementById('admin-table-container');
  if (!thead || !tbody) return;

  const mode = state.adminRegistry.mode;

  // Header style based on mode
  if (mode === 'DELETE') {
    thead.className = 'bg-rose-100 text-rose-950 uppercase font-black border-b-2 border-rose-300';
    if (tableContainer) tableContainer.className = 'overflow-x-auto rounded-xl border-2 border-rose-300 mb-4 bg-white shadow-sm';
  } else {
    thead.className = 'bg-slate-100 text-slate-900 uppercase font-black border-b-2 border-slate-300';
    if (tableContainer) tableContainer.className = 'overflow-x-auto rounded-xl border border-slate-300 mb-4 bg-white';
  }

  if (rows.length === 0) {
    thead.innerHTML = `<tr><th class="p-3.5">Result</th></tr>`;
    tbody.innerHTML = `<tr><td class="p-8 text-center text-slate-400 font-bold">No records match the current filter in ${sector.toUpperCase()} registry.</td></tr>`;
    return;
  }

  // Row Action Button Generator
  const renderActions = (itemSector, itemId, citizenId, title) => {
    if (mode === 'DELETE') {
      return `
        <div class="flex items-center justify-end gap-1.5 whitespace-nowrap">
          <button type="button" onclick="openAdminDeleteModal('${itemSector}', '${itemId}', '${citizenId}', '${escapeHtml(title)}')"
                  class="px-3.5 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg font-black text-[11px] shadow transition flex items-center gap-1.5">
            <i class="fa-solid fa-trash-can"></i> Delete Record
          </button>
          <button type="button" onclick="openAdminRecordDetailsModal('${itemSector}', '${itemId}')"
                  class="px-2 py-1.5 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-lg font-bold text-[11px] transition" title="Preview details">
            <i class="fa-solid fa-eye text-slate-600"></i>
          </button>
        </div>
      `;
    } else {
      return `
        <div class="flex items-center justify-end gap-1.5 whitespace-nowrap">
          <button type="button" onclick="openAdminRecordDetailsModal('${itemSector}', '${itemId}')"
                  class="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg font-bold text-[11px] transition shadow-sm">
            <i class="fa-solid fa-magnifying-glass text-[#8D153A] mr-1"></i> View Details
          </button>
          <button type="button" onclick="adminInspectCitizen('${citizenId}')"
                  class="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg font-bold text-[11px] transition">
            <i class="fa-solid fa-id-card text-[#8D153A] mr-1"></i> Card
          </button>
          <button type="button" onclick="openAdminDeleteModal('${itemSector}', '${itemId}', '${citizenId}', '${escapeHtml(title)}')"
                  class="px-2.5 py-1 bg-rose-50 hover:bg-rose-600 text-rose-700 hover:text-white border border-rose-200 rounded-lg font-bold text-[11px] transition">
            <i class="fa-solid fa-trash-can mr-1"></i> Delete
          </button>
        </div>
      `;
    }
  };

  const rowHoverClass = mode === 'DELETE' ? 'hover:bg-rose-50/60' : 'hover:bg-slate-50';

  if (sector === 'citizens') {
    thead.innerHTML = `
      <tr>
        <th class="p-3.5">Citizen ID</th>
        <th class="p-3.5">Full Legal Name</th>
        <th class="p-3.5">NIC Number</th>
        <th class="p-3.5">Gender / DOB</th>
        <th class="p-3.5">Phone</th>
        <th class="p-3.5">Status</th>
        <th class="p-3.5 text-right">Actions</th>
      </tr>
    `;
    tbody.innerHTML = rows.map(c => `
      <tr class="${rowHoverClass} transition text-xs border-b border-slate-200">
        <td class="p-3 font-mono font-bold text-[#8D153A]">${c.citizen_id}</td>
        <td class="p-3 font-bold text-slate-900">${[c.first_name, c.middle_names, c.last_name].filter(Boolean).join(' ')}</td>
        <td class="p-3 font-mono font-bold text-slate-700">${c.nic_number || 'N/A'}</td>
        <td class="p-3 font-medium text-slate-700">${c.gender} &bull; ${c.date_of_birth ? c.date_of_birth.substring(0, 10) : 'N/A'}</td>
        <td class="p-3 font-medium text-slate-600">${c.contact_phone || 'N/A'}</td>
        <td class="p-3">
          <span class="px-2 py-0.5 rounded-full font-bold text-[10px] ${c.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}">
            ${c.is_active ? 'ACTIVE' : 'DEACTIVATED'}
          </span>
        </td>
        <td class="p-3 text-right">
          ${renderActions('citizens', c.citizen_id, c.citizen_id, c.first_name + ' ' + c.last_name)}
        </td>
      </tr>
    `).join('');
  } else if (sector === 'hospital') {
    thead.innerHTML = `
      <tr>
        <th class="p-3.5">Record #</th>
        <th class="p-3.5">Citizen Name & ID</th>
        <th class="p-3.5">Diagnosed Condition</th>
        <th class="p-3.5">Hospital & Physician</th>
        <th class="p-3.5">Diagnosis Date</th>
        <th class="p-3.5">Chronic / Allergies</th>
        <th class="p-3.5 text-right">Actions</th>
      </tr>
    `;
    tbody.innerHTML = rows.map(r => `
      <tr class="${rowHoverClass} transition text-xs border-b border-slate-200">
        <td class="p-3 font-mono font-bold text-slate-500">#${r.medical_record_id}</td>
        <td class="p-3 font-bold text-slate-900">
          <div>${r.first_name || ''} ${r.last_name || ''}</div>
          <span class="font-mono text-[10px] text-[#8D153A]">${r.citizen_id}</span>
        </td>
        <td class="p-3 font-black text-red-900">${r.diagnosed_condition}</td>
        <td class="p-3 text-slate-700">
          <div class="font-semibold">${r.hospital_name}</div>
          <div class="text-[11px] text-slate-500">${r.treating_physician || 'N/A'}</div>
        </td>
        <td class="p-3 font-mono text-slate-600">${r.diagnosis_date ? r.diagnosis_date.substring(0, 10) : 'N/A'}</td>
        <td class="p-3 text-[11px] text-slate-600">
          ${r.chronic_flag ? '<span class="text-amber-800 font-bold bg-amber-100 px-1.5 py-0.5 rounded mr-1">CHRONIC</span>' : ''}
          ${r.allergies ? `<span class="italic font-medium">${r.allergies}</span>` : 'None reported'}
        </td>
        <td class="p-3 text-right">
          ${renderActions('hospital', r.medical_record_id, r.citizen_id, r.diagnosed_condition + ' @ ' + r.hospital_name)}
        </td>
      </tr>
    `).join('');
  } else if (sector === 'school') {
    thead.innerHTML = `
      <tr>
        <th class="p-3.5">Record #</th>
        <th class="p-3.5">Citizen Name & ID</th>
        <th class="p-3.5">School Name</th>
        <th class="p-3.5">Admission #</th>
        <th class="p-3.5">Tenure Years</th>
        <th class="p-3.5">Highest Grade & Conduct</th>
        <th class="p-3.5 text-right">Actions</th>
      </tr>
    `;
    tbody.innerHTML = rows.map(r => `
      <tr class="${rowHoverClass} transition text-xs border-b border-slate-200">
        <td class="p-3 font-mono font-bold text-slate-500">#${r.record_id}</td>
        <td class="p-3 font-bold text-slate-900">
          <div>${r.first_name || ''} ${r.last_name || ''}</div>
          <span class="font-mono text-[10px] text-[#8D153A]">${r.citizen_id}</span>
        </td>
        <td class="p-3 font-black text-amber-900">${r.school_name}</td>
        <td class="p-3 font-mono text-slate-700 font-bold">${r.admission_number || 'N/A'}</td>
        <td class="p-3 font-medium text-slate-700">${r.start_year || 'N/A'} &ndash; ${r.end_year || 'Present'}</td>
        <td class="p-3 text-slate-700">
          <span class="font-bold text-slate-900">${r.highest_grade_passed || 'N/A'}</span>
          ${r.conduct_remarks ? `<div class="text-[10px] text-slate-500 italic truncate max-w-xs">${r.conduct_remarks}</div>` : ''}
        </td>
        <td class="p-3 text-right">
          ${renderActions('school', r.record_id, r.citizen_id, r.school_name + ' (' + (r.admission_number || 'Record #' + r.record_id) + ')')}
        </td>
      </tr>
    `).join('');
  } else if (sector === 'university') {
    thead.innerHTML = `
      <tr>
        <th class="p-3.5">Record #</th>
        <th class="p-3.5">Citizen Name & ID</th>
        <th class="p-3.5">Institution</th>
        <th class="p-3.5">Qualification & Level</th>
        <th class="p-3.5">Class / GPA</th>
        <th class="p-3.5">Year & Status</th>
        <th class="p-3.5 text-right">Actions</th>
      </tr>
    `;
    tbody.innerHTML = rows.map(r => `
      <tr class="${rowHoverClass} transition text-xs border-b border-slate-200">
        <td class="p-3 font-mono font-bold text-slate-500">#${r.qualification_id}</td>
        <td class="p-3 font-bold text-slate-900">
          <div>${r.first_name || ''} ${r.last_name || ''}</div>
          <span class="font-mono text-[10px] text-[#8D153A]">${r.citizen_id}</span>
        </td>
        <td class="p-3 font-black text-purple-900">${r.institution_name}</td>
        <td class="p-3 text-slate-800">
          <div class="font-bold">${r.qualification_title}</div>
          <span class="text-[10px] bg-purple-50 text-purple-800 font-bold px-1.5 py-0.5 rounded">${r.qualification_level}</span>
        </td>
        <td class="p-3 font-bold text-slate-700">${r.class_or_gpa || 'N/A'}</td>
        <td class="p-3">
          <div class="font-medium text-slate-700">${r.graduation_year || 'N/A'}</div>
          <span class="px-2 py-0.5 rounded text-[10px] font-bold ${r.verification_status === 'VERIFIED' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}">
            ${r.verification_status}
          </span>
        </td>
        <td class="p-3 text-right">
          ${renderActions('university', r.qualification_id, r.citizen_id, r.qualification_title + ' @ ' + r.institution_name)}
        </td>
      </tr>
    `).join('');
  } else if (sector === 'police') {
    thead.innerHTML = `
      <tr>
        <th class="p-3.5">Licence #</th>
        <th class="p-3.5">Citizen Name & ID</th>
        <th class="p-3.5">Authorized Vehicle Classes</th>
        <th class="p-3.5">Issue & Expiry Dates</th>
        <th class="p-3.5">Demerits</th>
        <th class="p-3.5">Licence Status</th>
        <th class="p-3.5 text-right">Actions</th>
      </tr>
    `;
    tbody.innerHTML = rows.map(r => `
      <tr class="${rowHoverClass} transition text-xs border-b border-slate-200">
        <td class="p-3 font-mono font-bold text-teal-800">${r.licence_number}</td>
        <td class="p-3 font-bold text-slate-900">
          <div>${r.first_name || ''} ${r.last_name || ''}</div>
          <span class="font-mono text-[10px] text-[#8D153A]">${r.citizen_id}</span>
        </td>
        <td class="p-3 font-semibold text-slate-800">${r.vehicle_classes}</td>
        <td class="p-3 font-mono text-slate-600">${r.issue_date ? r.issue_date.substring(0, 10) : 'N/A'} &rarr; ${r.expiry_date ? r.expiry_date.substring(0, 10) : 'N/A'}</td>
        <td class="p-3 font-mono font-bold ${r.demerit_points > 0 ? 'text-rose-600' : 'text-slate-700'}">${r.demerit_points || 0}</td>
        <td class="p-3">
          <span class="px-2 py-0.5 rounded-full font-bold text-[10px] ${r.status === 'VALID' ? 'bg-teal-100 text-teal-800' : 'bg-rose-100 text-rose-800'}">
            ${r.status}
          </span>
        </td>
        <td class="p-3 text-right">
          ${renderActions('police', r.licence_id, r.citizen_id, 'Licence #' + r.licence_number)}
        </td>
      </tr>
    `).join('');
  } else if (sector === 'immigration') {
    thead.innerHTML = `
      <tr>
        <th class="p-3.5">Passport #</th>
        <th class="p-3.5">Citizen Name & ID</th>
        <th class="p-3.5">Issuing Authority</th>
        <th class="p-3.5">Validity Dates</th>
        <th class="p-3.5">Passport Status</th>
        <th class="p-3.5 text-right">Actions</th>
      </tr>
    `;
    tbody.innerHTML = rows.map(r => `
      <tr class="${rowHoverClass} transition text-xs border-b border-slate-200">
        <td class="p-3 font-mono font-bold text-orange-900">${r.passport_number}</td>
        <td class="p-3 font-bold text-slate-900">
          <div>${r.first_name || ''} ${r.last_name || ''}</div>
          <span class="font-mono text-[10px] text-[#8D153A]">${r.citizen_id}</span>
        </td>
        <td class="p-3 font-semibold text-slate-800">${r.issue_country || 'SRI LANKA'}</td>
        <td class="p-3 font-mono text-slate-600">${r.issue_date ? r.issue_date.substring(0, 10) : 'N/A'} &rarr; ${r.expiry_date ? r.expiry_date.substring(0, 10) : 'N/A'}</td>
        <td class="p-3">
          <span class="px-2 py-0.5 rounded-full font-bold text-[10px] ${r.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}">
            ${r.status}
          </span>
        </td>
        <td class="p-3 text-right">
          ${renderActions('immigration', r.passport_id, r.citizen_id, 'Passport #' + r.passport_number)}
        </td>
      </tr>
    `).join('');
  } else if (sector === 'registrar') {
    thead.innerHTML = `
      <tr>
        <th class="p-3.5">Registration #</th>
        <th class="p-3.5">Child / Citizen</th>
        <th class="p-3.5">Place of Birth & Hospital</th>
        <th class="p-3.5">Attending Physician</th>
        <th class="p-3.5">Registration Date</th>
        <th class="p-3.5 text-right">Actions</th>
      </tr>
    `;
    tbody.innerHTML = rows.map(r => `
      <tr class="${rowHoverClass} transition text-xs border-b border-slate-200">
        <td class="p-3 font-mono font-bold text-emerald-900">${r.registration_number}</td>
        <td class="p-3 font-bold text-slate-900">
          <div>${r.first_name || ''} ${r.last_name || ''}</div>
          <span class="font-mono text-[10px] text-[#8D153A]">${r.citizen_id}</span>
        </td>
        <td class="p-3 text-slate-800">
          <div class="font-bold">${r.place_of_birth}</div>
          <div class="text-[11px] text-slate-500">${r.hospital_name || 'N/A'}</div>
        </td>
        <td class="p-3 font-medium text-slate-700">${r.attending_physician || 'N/A'}</td>
        <td class="p-3 font-mono text-slate-600">${r.date_of_registration ? r.date_of_registration.substring(0, 10) : 'N/A'}</td>
        <td class="p-3 text-right">
          ${renderActions('registrar', r.birth_reg_id, r.citizen_id, 'Birth Reg #' + r.registration_number)}
        </td>
      </tr>
    `).join('');
  }
}

/**
 * Open Record Full Details Modal
 */
function openAdminRecordDetailsModal(sector, recordId) {
  const rows = state.adminRegistry.currentRows || [];
  let record = null;

  if (sector === 'citizens') {
    record = rows.find(r => String(r.citizen_id) === String(recordId));
  } else if (sector === 'hospital') {
    record = rows.find(r => String(r.medical_record_id) === String(recordId));
  } else if (sector === 'school') {
    record = rows.find(r => String(r.record_id) === String(recordId));
  } else if (sector === 'university') {
    record = rows.find(r => String(r.qualification_id) === String(recordId));
  } else if (sector === 'police') {
    record = rows.find(r => String(r.licence_id) === String(recordId));
  } else if (sector === 'immigration') {
    record = rows.find(r => String(r.passport_id) === String(recordId));
  } else if (sector === 'registrar') {
    record = rows.find(r => String(r.birth_reg_id) === String(recordId));
  }

  if (!record) {
    showToast('Record details not found in current memory cache.', 'error');
    return;
  }

  state.adminRegistry.activeRecord = { sector, recordId, data: record };

  const sectorLabels = {
    citizens: 'Citizen Master Registry',
    school: 'School Education Record',
    hospital: 'Hospital Medical Entry',
    university: 'Higher Education Qualification',
    police: 'Police Driving Licence',
    immigration: 'Immigration Passport Record',
    registrar: 'Civil Birth Registration'
  };

  setElementText('rec-detail-sector-badge', sectorLabels[sector] || sector.toUpperCase());
  setElementText('rec-detail-id-badge', `ID: #${recordId}`);
  setElementText('rec-detail-title', `${sectorLabels[sector]} Inspection`);

  const bodyEl = document.getElementById('rec-detail-body');
  if (!bodyEl) return;

  // Build key-value attribute cards
  let citizenHeader = `
    <div class="p-4 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between">
      <div>
        <div class="text-[10px] font-black uppercase text-slate-500 tracking-wider">Associated Citizen</div>
        <div class="text-sm font-black text-slate-900">${record.first_name || ''} ${record.last_name || ''}</div>
        <div class="text-xs font-mono font-bold text-[#8D153A]">${record.citizen_id || 'N/A'}</div>
      </div>
      <div class="text-right">
        <span class="text-[10px] font-black uppercase text-slate-500 block">NIC Number</span>
        <span class="text-xs font-mono font-bold text-slate-800">${record.nic_number || 'N/A'}</span>
      </div>
    </div>
  `;

  let detailsGrid = '';

  const attrItem = (label, val, fullWidth = false) => `
    <div class="p-3 bg-white border border-slate-200 rounded-xl ${fullWidth ? 'sm:col-span-2' : ''}">
      <div class="text-[10px] font-bold uppercase text-slate-500">${label}</div>
      <div class="text-xs font-black text-slate-900 mt-0.5">${val || 'N/A'}</div>
    </div>
  `;

  if (sector === 'citizens') {
    detailsGrid = `
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        ${attrItem('Citizen ID', record.citizen_id)}
        ${attrItem('National Identity Card (NIC)', record.nic_number)}
        ${attrItem('Full Legal Name', [record.first_name, record.middle_names, record.last_name].filter(Boolean).join(' '), true)}
        ${attrItem('Date of Birth', record.date_of_birth ? record.date_of_birth.substring(0, 10) : 'N/A')}
        ${attrItem('Gender', record.gender)}
        ${attrItem('Blood Group', record.blood_group)}
        ${attrItem('Contact Phone', record.contact_phone)}
        ${attrItem('Current Residential Address', record.current_address, true)}
        ${attrItem('Permanent Address', record.permanent_address, true)}
        ${attrItem('Status', record.is_active ? 'ACTIVE' : 'DEACTIVATED')}
        ${attrItem('Registered On', record.created_at ? record.created_at.substring(0, 19).replace('T', ' ') : 'N/A')}
      </div>
    `;
  } else if (sector === 'hospital') {
    detailsGrid = `
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        ${attrItem('Diagnosed Condition', record.diagnosed_condition, true)}
        ${attrItem('Hospital / Facility', record.hospital_name)}
        ${attrItem('Treating Physician', record.treating_physician)}
        ${attrItem('Diagnosis Date', record.diagnosis_date ? record.diagnosis_date.substring(0, 10) : 'N/A')}
        ${attrItem('Chronic Condition Flag', record.chronic_flag ? 'YES (CHRONIC)' : 'NO')}
        ${attrItem('Reported Allergies', record.allergies || 'None reported', true)}
        ${attrItem('Clinical Notes', record.notes || 'No confidential notes attached', true)}
        ${attrItem('System Timestamp', record.created_at ? record.created_at.substring(0, 19).replace('T', ' ') : 'N/A')}
      </div>
    `;
  } else if (sector === 'school') {
    detailsGrid = `
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        ${attrItem('School Name', record.school_name, true)}
        ${attrItem('Admission Number', record.admission_number)}
        ${attrItem('Enrolment Period', `${record.start_year || 'N/A'} - ${record.end_year || 'Present'}`)}
        ${attrItem('Highest Grade Completed', record.highest_grade_passed)}
        ${attrItem('Conduct & Disciplinary Remarks', record.conduct_remarks || 'Satisfactory conduct recorded', true)}
        ${attrItem('System Timestamp', record.created_at ? record.created_at.substring(0, 19).replace('T', ' ') : 'N/A')}
      </div>
    `;
  } else if (sector === 'university') {
    detailsGrid = `
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        ${attrItem('Qualification Title', record.qualification_title, true)}
        ${attrItem('Degree Level', record.qualification_level)}
        ${attrItem('Institution / University', record.institution_name)}
        ${attrItem('Class / GPA', record.class_or_gpa || 'N/A')}
        ${attrItem('Graduation Year', record.graduation_year || 'N/A')}
        ${attrItem('Verification Status', record.verification_status || 'VERIFIED')}
        ${attrItem('System Timestamp', record.created_at ? record.created_at.substring(0, 19).replace('T', ' ') : 'N/A')}
      </div>
    `;
  } else if (sector === 'police') {
    detailsGrid = `
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        ${attrItem('Driving Licence Number', record.licence_number)}
        ${attrItem('Authorized Vehicle Classes', record.vehicle_classes)}
        ${attrItem('Date of Issue', record.issue_date ? record.issue_date.substring(0, 10) : 'N/A')}
        ${attrItem('Date of Expiry', record.expiry_date ? record.expiry_date.substring(0, 10) : 'N/A')}
        ${attrItem('Accumulated Demerit Points', record.demerit_points || 0)}
        ${attrItem('Licence Status', record.status)}
      </div>
    `;
  } else if (sector === 'immigration') {
    detailsGrid = `
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        ${attrItem('Passport Document Number', record.passport_number)}
        ${attrItem('Issuing Country', record.issue_country || 'SRI LANKA')}
        ${attrItem('Date of Issue', record.issue_date ? record.issue_date.substring(0, 10) : 'N/A')}
        ${attrItem('Date of Expiry', record.expiry_date ? record.expiry_date.substring(0, 10) : 'N/A')}
        ${attrItem('Passport Status', record.status)}
        ${attrItem('System Timestamp', record.created_at ? record.created_at.substring(0, 19).replace('T', ' ') : 'N/A')}
      </div>
    `;
  } else if (sector === 'registrar') {
    detailsGrid = `
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        ${attrItem('Birth Registration Number', record.registration_number)}
        ${attrItem('Place of Birth', record.place_of_birth)}
        ${attrItem('Hospital of Birth', record.hospital_name || 'N/A')}
        ${attrItem('Attending Medical Officer', record.attending_physician || 'N/A')}
        ${attrItem('Date of Registration', record.date_of_registration ? record.date_of_registration.substring(0, 10) : 'N/A')}
        ${attrItem('Father Citizen ID', record.father_citizen_id || 'N/A')}
        ${attrItem('Mother Citizen ID', record.mother_citizen_id || 'N/A')}
        ${attrItem('Informant Name', record.informant_name || 'N/A')}
      </div>
    `;
  }

  bodyEl.innerHTML = `
    ${citizenHeader}
    <div class="pt-2">
      <div class="text-[10px] font-black uppercase text-slate-500 tracking-wider mb-2">Record Attributes</div>
      ${detailsGrid}
    </div>
  `;

  const modal = document.getElementById('admin-record-details-modal');
  if (modal) modal.classList.remove('hidden');
}

function closeAdminRecordDetailsModal() {
  const modal = document.getElementById('admin-record-details-modal');
  if (modal) modal.classList.add('hidden');
  state.adminRegistry.activeRecord = null;
}

function adminInspectCurrentRecordCitizen() {
  const active = state.adminRegistry.activeRecord;
  if (!active || !active.data?.citizen_id) return;
  const cId = active.data.citizen_id;
  closeAdminRecordDetailsModal();
  adminInspectCitizen(cId);
}

function adminDeleteFromDetailsModal() {
  const active = state.adminRegistry.activeRecord;
  if (!active) return;
  const sector = active.sector;
  const recordId = active.recordId;
  const citizenId = active.data?.citizen_id;
  const title = active.data?.first_name ? `${active.data.first_name} ${active.data.last_name}` : `Record #${recordId}`;

  closeAdminRecordDetailsModal();
  openAdminDeleteModal(sector, recordId, citizenId, title);
}

function adminInspectCitizen(citizenId) {
  if (!citizenId) return;
  state.currentCitizenId = citizenId;
  loadCitizenData(citizenId);
  switchView('view-citizen-card');
  showToast(`Switched inspection view to Citizen ${citizenId}`, 'info');
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

/**
 * Security Record Deletion Modal & Cascading Purge Action
 */
function openAdminDeleteModal(sector, recordId, citizenId, title) {
  state.adminRegistry.deleteTarget = { sector, recordId, citizenId, title };

  const secLabels = {
    citizens: 'Citizen Master Identity',
    hospital: 'Hospital Medical Record',
    school: 'School Education Record',
    university: 'University Degree Record',
    police: 'Police Driving Licence Record',
    immigration: 'Immigration Passport Record',
    registrar: 'Civil Birth Registration Record'
  };

  setElementText('del-modal-sector', secLabels[sector] || sector.toUpperCase());
  setElementText('del-modal-id', recordId);
  setElementText('del-modal-citizen', citizenId);
  setElementText('del-modal-desc', title);

  const errDiv = document.getElementById('admin-delete-modal-error');
  if (errDiv) errDiv.classList.add('hidden');

  const modal = document.getElementById('admin-delete-record-modal');
  if (modal) modal.classList.remove('hidden');
}

function closeAdminDeleteModal() {
  const modal = document.getElementById('admin-delete-record-modal');
  if (modal) modal.classList.add('hidden');
  state.adminRegistry.deleteTarget = null;
}

async function executeAdminDeleteRecord() {
  const target = state.adminRegistry.deleteTarget;
  if (!target) return;

  const btn = document.getElementById('btn-admin-confirm-delete');
  const errDiv = document.getElementById('admin-delete-modal-error');
  if (errDiv) errDiv.classList.add('hidden');

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-1"></i> Deleting Record...`;
  }

  try {
    let endpoint = `/admin/${target.sector}/${target.recordId}`;
    if (target.sector === 'registrar') {
      endpoint = `/admin/registrar/birth/${target.recordId}`;
    }

    const res = await apiRequest(endpoint, { method: 'DELETE' });
    if (!res.success) throw new Error(res.message || 'Delete operation failed.');

    closeAdminDeleteModal();
    showToast(`Successfully deleted: ${target.title}`, 'success');
    loadAdminRegistryData();
  } catch (error) {
    if (errDiv) {
      errDiv.textContent = error.message;
      errDiv.classList.remove('hidden');
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<i class="fa-solid fa-trash-can"></i> Confirm & Permanently Delete`;
    }
  }
}


/**
 * Switch Demo Persona Instantly
 */
async function switchPersona(username) {
  if (!username) return;

  try {
    const res = await apiRequest('/auth/login', {
      method: 'POST',
      body: { username, password: 'password123', direct_token: true }
    });

    if (res.token) {
      loginSuccess(res.token, res.user);
    }
  } catch (err) {
    showToast('Failed to switch persona: ' + err.message, 'error');
  }
}

/**
 * Helper UI Utilities
 */
function setElementText(id, text) {
  const el = document.getElementById(id);
  if (el) el.innerText = text;
}

function showToast(message, type = 'info') {
  const toast = document.getElementById('dashboard-toast');
  if (!toast) {
    alert(message);
    return;
  }

  toast.className = `p-4 rounded-xl border text-xs font-semibold animate-in fade-in transition ${
    type === 'success'
      ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
      : type === 'error'
      ? 'bg-rose-50 border-rose-300 text-rose-900'
      : 'bg-sky-50 border-sky-300 text-sky-900'
  }`;

  toast.innerHTML = `
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <i class="fa-solid ${type === 'success' ? 'fa-circle-check text-emerald-600' : 'fa-circle-info text-sky-600'} text-base"></i>
        <span>${message}</span>
      </div>
      <button onclick="this.parentElement.parentElement.classList.add('hidden')" class="text-slate-400 hover:text-slate-600">
        <i class="fa-solid fa-xmark"></i>
      </button>
    </div>
  `;

  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 5000);
}

/**
 * ============================================================================
 * PROFILE PICTURE MANAGEMENT & DYNAMIC AVATAR ENGINE
 * ============================================================================
 */

function getInitials(name) {
  if (!name) return 'ID';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function updateHeaderAvatar(photoUrl, initials) {
  const img = document.getElementById('header-avatar-img');
  const span = document.getElementById('header-avatar-initials');
  const isMale = (state.user?.gender || state.inspectedCitizen?.demographics?.gender || '').toUpperCase().startsWith('M');
  const defaultPhoto = isMale ? '/images/citizen_bilaal.jpg' : '/images/citizen_yumna.jpg';
  let photo = photoUrl;
  if (!photo || photo.includes('citizen_bilaal.jpg') || photo.includes('citizen_yumna.jpg')) {
    photo = state.user?.associated_citizen_id ? defaultPhoto : null;
  }

  if (img) {
    if (photo) {
      img.src = photo;
      img.onerror = function() {
        this.onerror = null;
        this.src = defaultPhoto;
      };
      img.classList.remove('hidden');
      if (span) span.classList.add('hidden');
    } else if (span) {
      img.classList.add('hidden');
      span.textContent = initials || 'U';
      span.classList.remove('hidden');
    }
  }
}

function renderCitizenCardPhoto(demo) {
  const photoContainer = document.getElementById('card-photo-container');
  if (!photoContainer) return;

  const initials = getInitials(demo.full_name || demo.first_name || 'Citizen');
  const isMale = (demo.gender || '').toUpperCase().startsWith('M');
  const genderDefaultPhoto = isMale ? '/images/citizen_bilaal.jpg' : '/images/citizen_yumna.jpg';

  let photoSrc = demo.profile_picture;
  // If no custom uploaded image, or if it has generic default image paths, ensure strict match with citizen's gender
  if (!photoSrc || photoSrc.includes('citizen_bilaal.jpg') || photoSrc.includes('citizen_yumna.jpg')) {
    photoSrc = genderDefaultPhoto;
  }

  photoContainer.innerHTML = `
    <img id="card-citizen-photo"
         src="${photoSrc}" 
         onerror="this.onerror=null; this.src='${genderDefaultPhoto}';" 
         class="w-full h-full object-cover" 
         alt="${demo.full_name || 'Citizen Portrait'}">
    <button onclick="openPhotoUploadModal('${demo.citizen_id}')" 
            class="absolute bottom-1.5 right-1.5 bg-[#8D153A] hover:bg-[#660B25] text-white w-7 h-7 rounded-full flex items-center justify-center text-xs shadow-md border-2 border-[#FFBE29] transition" 
            title="Upload / Change Profile Picture">
      <i class="fa-solid fa-camera text-[10px]"></i>
    </button>
  `;

  // Update button highlights if dashboard gender buttons exist
  const btnMale = document.getElementById('btn-dash-card-gender-male');
  const btnFemale = document.getElementById('btn-dash-card-gender-female');
  if (btnMale && btnFemale) {
    if (isMale) {
      btnMale.className = 'px-2.5 py-1 rounded-lg text-xs font-extrabold transition shadow-xs bg-[#8D153A] text-white';
      btnFemale.className = 'px-2.5 py-1 rounded-lg text-xs font-extrabold transition shadow-xs text-slate-700 hover:text-slate-900 bg-transparent';
    } else {
      btnFemale.className = 'px-2.5 py-1 rounded-lg text-xs font-extrabold transition shadow-xs bg-[#8D153A] text-white';
      btnMale.className = 'px-2.5 py-1 rounded-lg text-xs font-extrabold transition shadow-xs text-slate-700 hover:text-slate-900 bg-transparent';
    }
  }

  // Also sync with header if this is the citizen's own profile
  if (state.user && (state.user.associated_citizen_id === demo.citizen_id || state.user.role_name === 'CITIZEN')) {
    state.user.profile_picture = photoSrc;
    if (demo.gender) state.user.gender = demo.gender;
    localStorage.setItem('ocodr_user', JSON.stringify(state.user));
    updateHeaderAvatar(state.user.profile_picture, initials);
  }
}

function openPhotoUploadModal(citizenId) {
  const targetId = citizenId || (state.inspectedCitizen?.demographics?.citizen_id) || state.currentCitizenId;
  const input = document.getElementById('photo-upload-target-citizen-id');
  if (input) input.value = targetId;

  // Reset modal state
  const previewImg = document.getElementById('photo-preview-img');
  const previewCont = document.getElementById('photo-preview-container');
  const placeholder = document.getElementById('photo-preview-placeholder');
  const fileInput = document.getElementById('photo-file-input');
  const errorBox = document.getElementById('photo-upload-error');

  if (fileInput) fileInput.value = '';
  if (previewCont) previewCont.classList.add('hidden');
  if (placeholder) placeholder.classList.remove('hidden');
  if (errorBox) errorBox.classList.add('hidden');

  const modal = document.getElementById('photo-upload-modal');
  if (modal) modal.classList.remove('hidden');
}

function closePhotoUploadModal() {
  const modal = document.getElementById('photo-upload-modal');
  if (modal) modal.classList.add('hidden');
}

function previewSelectedPhoto(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;

  if (file.size > 10 * 1024 * 1024) {
    showToast('Image size exceeds 10MB limit.', 'error');
    e.target.value = '';
    return;
  }

  const reader = new FileReader();
  reader.onload = (event) => {
    const previewImg = document.getElementById('photo-preview-img');
    const previewCont = document.getElementById('photo-preview-container');
    const placeholder = document.getElementById('photo-preview-placeholder');

    if (previewImg) previewImg.src = event.target.result;
    if (placeholder) placeholder.classList.add('hidden');
    if (previewCont) previewCont.classList.remove('hidden');
  };
  reader.readAsDataURL(file);
}

async function handlePhotoUpload(e) {
  e.preventDefault();
  const fileInput = document.getElementById('photo-file-input');
  const targetCitizenId = document.getElementById('photo-upload-target-citizen-id').value;
  const submitBtn = document.getElementById('btn-submit-photo');
  const errorBox = document.getElementById('photo-upload-error');

  if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
    if (errorBox) {
      errorBox.textContent = 'Please choose an image file to upload.';
      errorBox.classList.remove('hidden');
    }
    return;
  }

  const file = fileInput.files[0];
  const formData = new FormData();
  formData.append('photo', file);

  const originalContent = submitBtn ? submitBtn.innerHTML : '';
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Uploading Photo...';
  }

  try {
    const res = await apiRequest(`/citizens/${targetCitizenId}/photo`, {
      method: 'POST',
      body: formData
    });

    showToast('Profile picture updated successfully!', 'success');
    closePhotoUploadModal();

    // Reload citizen data to immediately update ID card & header
    await loadCitizenData(targetCitizenId);
  } catch (err) {
    if (errorBox) {
      errorBox.textContent = err.message || 'Failed to upload photo.';
      errorBox.classList.remove('hidden');
    }
    showToast(err.message || 'Failed to upload photo.', 'error');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalContent;
    }
  }
}

/**
 * ============================================================================
 * EDIT CITIZEN INFORMATION CONTROLLERS
 * ============================================================================
 */

function openEditCitizenModal() {
  const userRole = (state.user?.role_name || '').toUpperCase();
  if (userRole !== 'ADMIN') {
    showToast('Permission Denied: Only system administrators are authorized to edit citizen information.', 'error');
    return;
  }

  const demo = state.inspectedCitizen?.demographics || {};
  const citizenIdInput = document.getElementById('edit-citizen-id');
  const displayId = document.getElementById('edit-display-citizen-id');
  const displayNic = document.getElementById('edit-display-nic');
  const firstNameInput = document.getElementById('edit-first-name');
  const lastNameInput = document.getElementById('edit-last-name');
  const phoneInput = document.getElementById('edit-contact-phone');
  const currentAddrInput = document.getElementById('edit-current-address');
  const permAddrInput = document.getElementById('edit-permanent-address');
  const bloodSelect = document.getElementById('edit-blood-group');
  const bloodContainer = document.getElementById('edit-blood-group-container');
  const errorBox = document.getElementById('edit-citizen-error');

  if (citizenIdInput) citizenIdInput.value = demo.citizen_id || state.currentCitizenId;
  if (displayId) displayId.textContent = demo.citizen_id || state.currentCitizenId;
  if (displayNic) displayNic.textContent = demo.nic_number || 'N/A';
  if (firstNameInput) {
    firstNameInput.value = demo.first_name || '';
    firstNameInput.readOnly = false;
    firstNameInput.className = 'w-full p-2.5 rounded-lg text-xs border bg-white border-slate-300 focus:border-amber-500';
  }
  if (lastNameInput) {
    lastNameInput.value = demo.last_name || '';
    lastNameInput.readOnly = false;
    lastNameInput.className = 'w-full p-2.5 rounded-lg text-xs border bg-white border-slate-300 focus:border-amber-500';
  }
  if (phoneInput) phoneInput.value = demo.contact_phone || '';
  if (currentAddrInput) currentAddrInput.value = demo.current_address || '';
  if (permAddrInput) permAddrInput.value = demo.permanent_address || '';
  if (bloodSelect && demo.blood_group) bloodSelect.value = demo.blood_group;
  if (bloodContainer) bloodContainer.classList.remove('hidden');

  if (errorBox) errorBox.classList.add('hidden');

  const modal = document.getElementById('edit-citizen-modal');
  if (modal) modal.classList.remove('hidden');
}

function closeEditCitizenModal() {
  const modal = document.getElementById('edit-citizen-modal');
  if (modal) modal.classList.add('hidden');
}

async function handleEditCitizenSubmit(e) {
  e.preventDefault();
  const userRole = (state.user?.role_name || '').toUpperCase();
  if (userRole !== 'ADMIN') {
    showToast('Permission Denied: Only system administrators can edit citizen records.', 'error');
    return;
  }

  const citizenId = document.getElementById('edit-citizen-id').value;
  const submitBtn = document.getElementById('btn-submit-edit-citizen');
  const errorBox = document.getElementById('edit-citizen-error');

  const phone = document.getElementById('edit-contact-phone').value.trim();
  const currentAddress = document.getElementById('edit-current-address').value.trim();
  const permanentAddress = document.getElementById('edit-permanent-address').value.trim();
  const firstName = document.getElementById('edit-first-name').value.trim();
  const lastName = document.getElementById('edit-last-name').value.trim();
  const bloodGroup = document.getElementById('edit-blood-group')?.value;

  const payload = {
    contact_phone: phone,
    current_address: currentAddress,
    permanent_address: permanentAddress
  };

  if (firstName) payload.first_name = firstName;
  if (lastName) payload.last_name = lastName;
  if (bloodGroup) payload.blood_group = bloodGroup;

  const originalContent = submitBtn ? submitBtn.innerHTML : '';
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving Updates...';
  }

  try {
    const res = await apiRequest(`/citizens/${citizenId}`, {
      method: 'PUT',
      body: payload
    });

    showToast('Citizen information updated successfully!', 'success');
    closeEditCitizenModal();

    // Reload active citizen data to update digital card and views immediately
    await loadCitizenData(citizenId);
  } catch (err) {
    if (errorBox) {
      errorBox.textContent = err.message || 'Failed to update citizen information.';
      errorBox.classList.remove('hidden');
    }
    showToast(err.message || 'Failed to update information.', 'error');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalContent;
    }
  }
}

/* ============================================================================
 * DELETE / CLEAR CITIZEN INFORMATION MODAL LOGIC
 * ============================================================================
 */

function openDeleteCitizenModal() {
  const userRole = (state.user?.role_name || '').toUpperCase();
  if (userRole !== 'ADMIN') {
    showToast('Forbidden: Only system administrators are authorized to delete or clear citizen information.', 'error');
    return;
  }

  const demo = state.inspectedCitizen?.demographics || {};
  const citizenId = demo.citizen_id || state.currentCitizenId;
  const fullName = demo.full_name || `${demo.first_name || ''} ${demo.last_name || ''}`.trim() || 'Citizen';

  const nameEl = document.getElementById('del-display-name');
  const idEl = document.getElementById('del-display-id');
  const targetIdEl = document.getElementById('del-confirm-target');
  const photoStatusEl = document.getElementById('del-photo-status');
  const phoneStatusEl = document.getElementById('del-phone-status');
  const addressStatusEl = document.getElementById('del-address-status');
  const dangerTitleEl = document.getElementById('del-danger-title');
  const dangerDescEl = document.getElementById('del-danger-desc');
  const delBtnLabel = document.getElementById('del-btn-label');
  const confirmInput = document.getElementById('del-confirm-input');
  const confirmBtn = document.getElementById('btn-confirm-delete-record');
  const errorBox = document.getElementById('delete-citizen-error');

  if (nameEl) nameEl.textContent = fullName;
  if (idEl) idEl.textContent = citizenId;
  if (targetIdEl) targetIdEl.textContent = citizenId;

  // Photo status
  const btnDeletePhoto = document.getElementById('btn-delete-photo');
  if (photoStatusEl) {
    if (demo.profile_picture) {
      photoStatusEl.textContent = 'Custom photograph uploaded';
      if (btnDeletePhoto) {
        btnDeletePhoto.disabled = false;
        btnDeletePhoto.classList.remove('opacity-40', 'cursor-not-allowed');
      }
    } else {
      photoStatusEl.textContent = 'Using default initials avatar';
      if (btnDeletePhoto) {
        btnDeletePhoto.disabled = true;
        btnDeletePhoto.classList.add('opacity-40', 'cursor-not-allowed');
      }
    }
  }

  // Phone status
  const btnClearPhone = document.getElementById('btn-clear-phone');
  if (phoneStatusEl) {
    if (demo.contact_phone) {
      phoneStatusEl.textContent = demo.contact_phone;
      if (btnClearPhone) {
        btnClearPhone.disabled = false;
        btnClearPhone.classList.remove('opacity-40', 'cursor-not-allowed');
      }
    } else {
      phoneStatusEl.textContent = '(Not registered)';
      if (btnClearPhone) {
        btnClearPhone.disabled = true;
        btnClearPhone.classList.add('opacity-40', 'cursor-not-allowed');
      }
    }
  }

  // Address status
  const btnClearAddress = document.getElementById('btn-clear-address');
  if (addressStatusEl) {
    if (demo.current_address) {
      addressStatusEl.textContent = demo.current_address;
      if (btnClearAddress) {
        btnClearAddress.disabled = false;
        btnClearAddress.classList.remove('opacity-40', 'cursor-not-allowed');
      }
    } else {
      addressStatusEl.textContent = '(Not registered)';
      if (btnClearAddress) {
        btnClearAddress.disabled = true;
        btnClearAddress.classList.add('opacity-40', 'cursor-not-allowed');
      }
    }
  }

  // Configure Danger Zone based on role
  if (confirmInput) confirmInput.value = '';
  if (confirmBtn) confirmBtn.disabled = true;
  if (errorBox) errorBox.classList.add('hidden');

  if (userRole === 'CITIZEN') {
    if (dangerTitleEl) dangerTitleEl.textContent = 'Digital Account Deactivation';
    if (dangerDescEl) dangerDescEl.textContent = 'Deactivating will disable your portal login and clear voluntary contact details. Your statutory civil registration records remain secured.';
    if (delBtnLabel) delBtnLabel.textContent = 'Deactivate My Digital Profile';
  } else if (['REGISTRAR', 'ADMIN'].includes(userRole)) {
    if (dangerTitleEl) dangerTitleEl.textContent = 'Deregister / Deactivate Citizen';
    if (dangerDescEl) dangerDescEl.textContent = 'Soft-deactivates this citizen from the active national registry. Record is preserved for statutory audit & police inquiries.';
    if (delBtnLabel) delBtnLabel.textContent = 'Deactivate Citizen from Registry';
  }

  const modal = document.getElementById('delete-citizen-modal');
  if (modal) modal.classList.remove('hidden');
}

function closeDeleteCitizenModal() {
  const modal = document.getElementById('delete-citizen-modal');
  if (modal) modal.classList.add('hidden');
}

function checkDeleteConfirmationMatch() {
  const targetId = document.getElementById('del-confirm-target')?.textContent.trim();
  const inputVal = document.getElementById('del-confirm-input')?.value.trim();
  const confirmBtn = document.getElementById('btn-confirm-delete-record');
  if (confirmBtn) {
    confirmBtn.disabled = (inputVal !== targetId);
  }
}

async function handleDeleteProfilePhoto() {
  const demo = state.inspectedCitizen?.demographics || {};
  const citizenId = demo.citizen_id || state.currentCitizenId;
  const btn = document.getElementById('btn-delete-photo');
  const errorBox = document.getElementById('delete-citizen-error');

  if (!confirm('Are you sure you want to delete this profile photograph? Default initials avatar will be restored.')) {
    return;
  }

  const originalHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Deleting...';
  }

  try {
    await apiRequest(`/citizens/${citizenId}/photo`, { method: 'DELETE' });
    showToast('Profile photo removed successfully. Initials avatar restored.', 'success');
    closeDeleteCitizenModal();
    await loadCitizenData(citizenId);
    
    // Update navbar avatar if viewing own record
    const topAvatar = document.getElementById('header-avatar-img');
    if (topAvatar && state.user.associated_citizen_id === citizenId) {
      topAvatar.src = '/images/citizen_yumna.jpg';
    }
  } catch (err) {
    if (errorBox) {
      errorBox.textContent = err.message || 'Failed to delete photo.';
      errorBox.classList.remove('hidden');
    }
    showToast(err.message || 'Failed to delete profile photo.', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }
  }
}

async function handleClearCitizenField(fieldName) {
  const demo = state.inspectedCitizen?.demographics || {};
  const citizenId = demo.citizen_id || state.currentCitizenId;
  const errorBox = document.getElementById('delete-citizen-error');
  const label = fieldName === 'contact_phone' ? 'phone number' : 'residential address';

  if (!confirm(`Are you sure you want to clear the registered ${label}?`)) {
    return;
  }

  try {
    await apiRequest(`/citizens/${citizenId}/field/${fieldName}`, { method: 'DELETE' });
    showToast(`Registered ${label} cleared successfully.`, 'success');
    closeDeleteCitizenModal();
    await loadCitizenData(citizenId);
  } catch (err) {
    if (errorBox) {
      errorBox.textContent = err.message || `Failed to clear ${label}.`;
      errorBox.classList.remove('hidden');
    }
    showToast(err.message || `Failed to clear ${label}.`, 'error');
  }
}

async function handleDeleteCitizenRecord() {
  const demo = state.inspectedCitizen?.demographics || {};
  const citizenId = demo.citizen_id || state.currentCitizenId;
  const userRole = (state.user?.role_name || '').toUpperCase();
  const btn = document.getElementById('btn-confirm-delete-record');
  const errorBox = document.getElementById('delete-citizen-error');

  const actionName = userRole === 'CITIZEN' ? 'deactivate your account' : `deactivate citizen record '${citizenId}'`;
  if (!confirm(`FINAL CONFIRMATION: Are you certain you wish to ${actionName}?`)) {
    return;
  }

  const originalHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Processing...';
  }

  try {
    const res = await apiRequest(`/citizens/${citizenId}`, { method: 'DELETE' });
    showToast(res.message || 'Citizen record successfully deactivated.', 'success');
    closeDeleteCitizenModal();

    if (userRole === 'CITIZEN') {
      setTimeout(() => {
        handleLogout();
      }, 1500);
    } else {
      await loadCitizenData(citizenId);
    }
  } catch (err) {
    if (errorBox) {
      errorBox.textContent = err.message || 'Failed to deactivate citizen record.';
      errorBox.classList.remove('hidden');
    }
    showToast(err.message || 'Failed to deactivate citizen record.', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }
  }
}

async function handleDeleteDocument(docId, docTitle) {
  const userRole = (state.user?.role_name || '').toUpperCase();
  if (userRole === 'CITIZEN') {
    showToast('Security Violation: Citizens are not permitted to delete information or documents.', 'error');
    return;
  }

  if (!confirm(`Are you sure you want to permanently delete the document '${docTitle || 'document'}'?`)) {
    return;
  }

  try {
    const res = await apiRequest(`/documents/${docId}`, { method: 'DELETE' });
    showToast(res.message || 'Document deleted successfully.', 'success');
    const demo = state.inspectedCitizen?.demographics || {};
    const citizenId = demo.citizen_id || state.currentCitizenId;
    if (citizenId) {
      await loadCitizenDocuments(citizenId);
    }
  } catch (err) {
    showToast(err.message || 'Failed to delete document.', 'error');
  }
}

