// Public site behaviour. Wrapped in a function: a global `const top` would clash with window.top.
(() => {
  // Header turns solid on scroll
  const header = document.getElementById('s-top');
  if (header) {
    const onScroll = () => header.classList.toggle('solid', scrollY > 30);
    addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // Row arrows
  document.querySelectorAll('.row').forEach(row => {
    const track = row.querySelector('.track');
    row.querySelectorAll('.arrow').forEach(b => b.addEventListener('click', () =>
      track.scrollBy({ left: (b.dataset.dir === 'r' ? 1 : -1) * track.clientWidth * 0.85, behavior: 'smooth' })));
  });

  // Browse filters submit on change
  document.querySelectorAll('.filterbar select').forEach(s => s.addEventListener('change', () => s.form.submit()));

  // Hero carousel
  const slides = [...document.querySelectorAll('.slide')], dots = [...document.querySelectorAll('.dots button')];
  if (slides.length > 1) {
    let i = 0, timer;
    const go = n => { slides[i].classList.remove('on'); dots[i].classList.remove('on'); i = (n + slides.length) % slides.length; slides[i].classList.add('on'); dots[i].classList.add('on'); };
    const start = () => { clearInterval(timer); timer = setInterval(() => go(i + 1), 7000); };
    dots.forEach(d => d.addEventListener('click', () => { go(+d.dataset.i); start(); }));
    start();
  }

  // Trailer modal (privacy-enhanced YouTube embed)
  const modal = document.getElementById('trailer-modal');
  if (modal) {
    const frame = modal.querySelector('.modal-frame');
    const close = () => { modal.hidden = true; frame.innerHTML = ''; document.body.style.overflow = ''; };
    document.addEventListener('click', e => {
      const t = e.target.closest('[data-trailer]');
      if (t) {
        e.preventDefault();
        frame.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(t.dataset.trailer)}?autoplay=1&rel=0" allow="autoplay; encrypted-media; fullscreen" allowfullscreen title="Trailer"></iframe>`;
        modal.hidden = false; document.body.style.overflow = 'hidden';
      } else if (e.target === modal || e.target.closest('.modal-x')) close();
    });
    addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.hidden) close(); });
  }

  // Live search suggestions: type -> TMDB matches -> click opens the title at its player
  const searchForm = document.querySelector('.s-search[data-suggest]');
  if (searchForm) {
    const input = searchForm.querySelector('input[name="q"]');
    const list = searchForm.querySelector('.s-suggest');
    let items = [], active = -1, timer, ctrl;

    const closeList = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); active = -1; };
    const highlight = i => {
      active = i;
      [...list.children].forEach((li, n) => li.classList.toggle('on', n === i));
      input.setAttribute('aria-activedescendant', i >= 0 ? `sg-${i}` : '');
    };
    const render = results => {
      items = results;
      list.replaceChildren(...results.map((r, i) => {
        const li = document.createElement('li');
        li.id = `sg-${i}`;
        li.setAttribute('role', 'option');
        const a = document.createElement('a');
        a.href = r.href;
        if (r.poster) {
          const img = document.createElement('img');
          img.src = r.poster; img.alt = ''; img.loading = 'lazy';
          a.append(img);
        } else {
          const ph = document.createElement('span');
          ph.className = 'sg-noimg';
          a.append(ph);
        }
        const text = document.createElement('span');
        const b = document.createElement('b'); b.textContent = r.title;
        const small = document.createElement('small'); small.textContent = [r.year, r.type].filter(Boolean).join(' · ');
        text.append(b, small);
        const play = document.createElement('span'); play.className = 'sg-play'; play.textContent = '▶';
        a.append(text, play);
        li.append(a);
        li.addEventListener('mouseenter', () => highlight(i));
        return li;
      }));
      list.hidden = !results.length;
      input.setAttribute('aria-expanded', String(!!results.length));
      highlight(-1);
    };

    input.addEventListener('input', () => {
      clearTimeout(timer);
      const q = input.value.trim();
      if (q.length < 2) { ctrl?.abort(); closeList(); return; }
      timer = setTimeout(async () => {
        ctrl?.abort();
        ctrl = new AbortController();
        try {
          const r = await fetch(`${searchForm.dataset.suggest}?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
          if (r.ok && input.value.trim() === q) render(await r.json());
        } catch {} // aborted or offline: keep the plain search form working
      }, 250);
    });
    input.addEventListener('keydown', e => {
      if (list.hidden) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); highlight((active + 1) % items.length); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); highlight((active - 1 + items.length) % items.length); }
      else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); location.href = items[active].href; }
      else if (e.key === 'Escape') closeList();
    });
    input.addEventListener('focus', () => { if (list.children.length && input.value.trim().length >= 2) { list.hidden = false; input.setAttribute('aria-expanded', 'true'); } });
    document.addEventListener('click', e => { if (!searchForm.contains(e.target)) closeList(); });
  }

  // Netflix-Style Who's Watching? Modal (Images 3, 5, 6, 7)
  const wwModal = document.getElementById('whos-watching-modal');
  const wwBtn = document.getElementById('btn-whos-watching');
  const wwViewSelect = document.getElementById('ww-view-select');
  const wwViewForm = document.getElementById('ww-view-form');
  const wwSelectTitle = document.getElementById('ww-select-title');
  const wwSelectSub = document.getElementById('ww-select-sub');
  const wwGrid = document.getElementById('ww-profiles-grid');
  const wwManageBtn = document.getElementById('btn-ww-manage');
  const wwCancelBtn = document.getElementById('btn-ww-cancel');
  const wwMainActions = document.getElementById('ww-main-actions');

  // Integrated Center PIN Prompt elements (NO boxed card)
  const wwPinPrompt = document.getElementById('ww-pin-prompt');
  const wwPinBoxes = document.getElementById('ww-pin-boxes');
  const wwPinDigits = document.querySelectorAll('.ww-pin-digit');
  const wwPinError = document.getElementById('ww-pin-error');
  const wwPinCancelBtn = document.getElementById('btn-ww-pin-cancel');

  // Form View elements
  const wwFormHeading = document.getElementById('ww-form-heading');
  const wwFormPreviewImg = document.getElementById('ww-form-preview-img');
  const wwFormPreviewName = document.getElementById('ww-form-preview-name');
  const wwProfileForm = document.getElementById('ww-profile-form');
  const wwEditId = document.getElementById('ww-edit-id');
  const wwProfileName = document.getElementById('ww-profile-name');
  const wwCharCount = document.getElementById('ww-char-count');
  const wwAvatarSearchInput = document.getElementById('ww-avatar-search-input');
  const wwAvatarGrid = document.getElementById('ww-avatar-grid');
  const wwIsKids = document.getElementById('ww-is-kids');
  const wwKidsLockNotice = document.getElementById('ww-kids-lock-notice');
  const wwLockPin = document.getElementById('ww-lock-pin');
  const wwPinFormGroup = document.getElementById('ww-pin-form-group');
  const wwOldPinRow = document.getElementById('ww-old-pin-row');
  const wwOldPinInput = document.getElementById('ww-old-pin-input');
  const wwNewPinRow = document.getElementById('ww-new-pin-row');
  const wwPinInputLabel = document.getElementById('ww-pin-input-label');
  const wwPinInput = document.getElementById('ww-pin-input');
  const wwPinStatusText = document.getElementById('ww-pin-status-text');
  const wwPinFormError = document.getElementById('ww-pin-form-error');
  const wwPinChangeBtn = document.getElementById('btn-ww-pin-change');
  const wwFormCancel = document.getElementById('btn-ww-form-cancel');
  const wwDeleteBtn = document.getElementById('btn-ww-delete');
  const wwDeleteDialog = document.getElementById('ww-delete-dialog');
  const wwDeleteDialogTitle = document.getElementById('ww-delete-dialog-title');
  const wwDeleteConfirmBtn = document.getElementById('btn-ww-delete-confirm');
  const wwDeleteCancelBtn = document.getElementById('btn-ww-delete-cancel');

  const AVATAR_PRESETS = [
    { id: 'alien', name: 'Alien', path: '/profiles/avatars/alien.svg' },
    { id: 'blue-classic-icon', name: 'Blue Classic Icon', path: '/profiles/avatars/blue-classic-icon.svg' },
    { id: 'chicken', name: 'Chicken', path: '/profiles/avatars/chicken.svg' },
    { id: 'dark-grey-smile', name: 'Dark Grey Smile', path: '/profiles/avatars/dark-grey-smile.svg' },
    { id: 'dog', name: 'Dog', path: '/profiles/avatars/dog.svg' },
    { id: 'dusty-chilleez', name: 'Dusty Chilleez', path: '/profiles/avatars/dusty-chilleez.svg' },
    { id: 'eyepatch', name: 'Eyepatch', path: '/profiles/avatars/eyepatch.svg' },
    { id: 'green-smile', name: 'Green Smile', path: '/profiles/avatars/green-smile.svg' },
    { id: 'helmet', name: 'Helmet', path: '/profiles/avatars/helmet.svg' },
    { id: 'moustache', name: 'Moustache', path: '/profiles/avatars/moustache.svg' },
    { id: 'mummy', name: 'Mummy', path: '/profiles/avatars/mummy.svg' },
    { id: 'pink-giggle', name: 'Pink Giggle', path: '/profiles/avatars/pink-giggle.svg' },
    { id: 'pink-smile', name: 'Pink Smile', path: '/profiles/avatars/pink-smile.svg' },
    { id: 'purple-penguin', name: 'Purple Penguin', path: '/profiles/avatars/purple-penguin.svg' },
    { id: 'purple-smile', name: 'Purple Smile', path: '/profiles/avatars/purple-smile.svg' },
    { id: 'purple-superhero', name: 'Purple Superhero', path: '/profiles/avatars/purple-superhero.svg' },
    { id: 'red-smile', name: 'Red Smile', path: '/profiles/avatars/red-smile.svg' },
    { id: 'robin-chilleez', name: 'Robin Chilleez', path: '/profiles/avatars/robin-chilleez.svg' },
    { id: 'robot', name: 'Robot', path: '/profiles/avatars/robot.svg' },
    { id: 'scarlet-chilleez', name: 'Scarlet Chilleez', path: '/profiles/avatars/scarlet-chilleez.svg' },
    { id: 'sunny-chilleez', name: 'Sunny Chilleez', path: '/profiles/avatars/sunny-chilleez.svg' },
    { id: 'yellow-smile', name: 'Yellow Smile', path: '/profiles/avatars/yellow-smile.svg' },
    { id: 'red-superhero', name: 'Red Superhero', path: '/profiles/avatars/red-superhero.svg' }
  ];

  let profilesData = [];
  let currentActiveId = null;
  let isManageMode = false;
  let isSwitchingProfile = false;
  let selectedAvatar = '/profiles/avatars/blue-classic-icon.svg';
  let presetsList = AVATAR_PRESETS;
  let pendingPinProfile = null;
  let isHeroPinActive = false;
  let pendingPinHeroItem = null;

  function hasLockedAdultProfile(excludeId = null) {
    return profilesData.some(p => p.id !== Number(excludeId) && !p.is_kids && p.has_pin);
  }

  // Pre-populate profiles data from server-rendered JSON if available
  const initDataEl = document.getElementById('ww-init-data');
  if (initDataEl) {
    try {
      const initData = JSON.parse(initDataEl.textContent);
      if (initData && Array.isArray(initData.profiles) && initData.profiles.length) {
        profilesData = initData.profiles;
        currentActiveId = initData.activeProfileId;
        renderProfiles();
      }
    } catch (e) {}
  }

  async function loadProfiles() {
    try {
      const res = await fetch('/api/profiles');
      if (!res.ok) return;
      const data = await res.json();
      profilesData = data.profiles || [];
      currentActiveId = data.activeProfileId;
      if (data.presets && data.presets.length) {
        presetsList = data.presets;
      }
      const activeP = profilesData.find(p => p.id === currentActiveId);
      if (activeP) {
        const navImg = document.getElementById('nav-profile-avatar-img');
        if (navImg && activeP.avatar) navImg.src = activeP.avatar;
        const settingsName = document.querySelector('.s-settings-user-name');
        if (settingsName && activeP.name) settingsName.textContent = activeP.name;
      }
      renderProfiles();
    } catch (e) {
      console.error('Failed to load profiles:', e);
    }
  }

  function renderProfiles() {
    if (!wwGrid || isSwitchingProfile) return;
    wwGrid.innerHTML = '';
    wwGrid.classList.toggle('manage-mode', isManageMode);

    const activeP = profilesData.find(p => p.id === currentActiveId);
    if (activeP && activeP.is_kids) {
      if (wwManageBtn) wwManageBtn.style.display = 'none';
      isManageMode = false;
    } else {
      if (wwManageBtn) wwManageBtn.style.display = '';
    }

    profilesData.forEach(p => {
      const item = document.createElement('div');
      item.className = 'ww-profile-item' + (p.id === currentActiveId ? ' active' : '');
      item.dataset.id = p.id;

      const wrap = document.createElement('div');
      wrap.className = 'ww-avatar-wrap';

      const img = document.createElement('img');
      img.src = p.avatar;
      img.alt = p.name;
      wrap.appendChild(img);

      if (p.id === currentActiveId) {
        const activeBadge = document.createElement('span');
        activeBadge.className = 'ww-active-badge';
        activeBadge.textContent = 'CURRENT';
        wrap.appendChild(activeBadge);
      }

      if (p.is_kids) {
        const kidsBadge = document.createElement('span');
        kidsBadge.className = 'ww-kids-badge';
        kidsBadge.textContent = 'KIDS';
        wrap.appendChild(kidsBadge);
      }

      if (p.has_pin) {
        const lockBadge = document.createElement('div');
        lockBadge.className = 'ww-lock-badge';
        lockBadge.title = 'Profile Locked';
        lockBadge.innerHTML = `
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
            <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/>
          </svg>
        `;
        wrap.appendChild(lockBadge);
      }

      const overlay = document.createElement('div');
      overlay.className = 'ww-edit-overlay';
      overlay.innerHTML = `
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
        </svg>
      `;
      wrap.appendChild(overlay);

      const nameSpan = document.createElement('span');
      nameSpan.className = 'ww-profile-name';
      nameSpan.textContent = p.name;

      item.appendChild(wrap);
      item.appendChild(nameSpan);

      item.addEventListener('click', () => {
        if (isManageMode) {
          openEditProfileForm(p);
        } else {
          if (activeP && activeP.is_kids && !p.is_kids) {
            // Child attempting to switch to an adult profile requires adult PIN
            startHeroPinChallenge(p, item, true);
          } else if (p.has_pin) {
            startHeroPinChallenge(p, item, false);
          } else {
            switchProfile(p.id, item);
          }
        }
      });

      wwGrid.appendChild(item);
    });

    // Add Profile button (if < 6 profiles and not in manage mode and not a kids profile)
    if (profilesData.length < 6 && !isManageMode && !(activeP && activeP.is_kids)) {
      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'ww-profile-item ww-add-item';
      addBtn.id = 'btn-ww-add-profile';
      addBtn.innerHTML = `
        <div class="ww-avatar-wrap ww-add-wrap">
          <span class="ww-add-plus">+</span>
        </div>
        <span class="ww-profile-name">Add Profile</span>
      `;
      addBtn.addEventListener('click', openAddProfileForm);
      wwGrid.appendChild(addBtn);
    }
  }

  function startHeroPinChallenge(targetProfile, clickedItem, isExitingKids = false) {
    if (isSwitchingProfile || isHeroPinActive) return;
    isHeroPinActive = true;
    pendingPinProfile = targetProfile;
    pendingPinHeroItem = clickedItem;

    const itemRect = clickedItem.getBoundingClientRect();
    const itemCenterX = itemRect.left + itemRect.width / 2;
    const itemCenterY = itemRect.top + itemRect.height / 2;
    const viewportCenterX = window.innerWidth / 2;
    const targetCenterY = (window.innerHeight / 2) - 105;
    const deltaX = Math.round(viewportCenterX - itemCenterX);
    const deltaY = Math.round(targetCenterY - itemCenterY);

    clickedItem.dataset.heroDeltaX = deltaX;
    clickedItem.dataset.heroDeltaY = deltaY;
    clickedItem.dataset.itemCenterY = itemCenterY;

    clickedItem.classList.add('selected-hero');
    clickedItem.style.zIndex = '9999';
    clickedItem.style.transition = 'transform 0.44s cubic-bezier(0.16, 1, 0.3, 1)';
    clickedItem.style.transform = `translate3d(${deltaX}px, ${deltaY}px, 0) scale(1.15)`;

    document.querySelectorAll('.ww-profile-item').forEach(el => {
      if (el !== clickedItem) el.classList.add('ww-dim-item');
    });
    if (wwSelectTitle) wwSelectTitle.classList.add('ww-fade-element');
    if (wwSelectSub) wwSelectSub.classList.add('ww-fade-element');
    if (wwMainActions) wwMainActions.classList.add('ww-fade-element');

    if (wwPinPrompt) {
      wwPinPrompt.hidden = false;
      wwPinPrompt.style.opacity = '1';
      const titleEl = wwPinPrompt.querySelector('.ww-pin-prompt-title');
      const subEl = wwPinPrompt.querySelector('.ww-pin-prompt-sub');
      if (isExitingKids) {
        if (titleEl) titleEl.textContent = 'Parental Lock';
        if (subEl) subEl.textContent = 'Enter PIN to exit Kids.';
      } else {
        if (titleEl) titleEl.textContent = 'Profile Locked';
        if (subEl) subEl.textContent = 'Enter your 4-digit PIN.';
      }
    }
    if (wwPinError) {
      wwPinError.style.display = 'none';
      wwPinError.textContent = '';
    }
    if (wwPinBoxes) wwPinBoxes.classList.remove('pin-shake');
    if (wwPinDigits) {
      wwPinDigits.forEach(i => { i.value = ''; });
    }
    setTimeout(() => {
      if (wwPinDigits && wwPinDigits[0]) wwPinDigits[0].focus();
    }, 120);
  }

  function cancelHeroPinChallenge() {
    if (!isHeroPinActive) return;
    if (wwPinPrompt) {
      wwPinPrompt.hidden = true;
    }
    if (pendingPinHeroItem) {
      const hero = pendingPinHeroItem;
      hero.style.transition = 'transform 0.38s cubic-bezier(0.16, 1, 0.3, 1)';
      hero.style.transform = 'translate3d(0, 0, 0) scale(1)';
      setTimeout(() => {
        hero.classList.remove('selected-hero');
        hero.style.transform = '';
        hero.style.transition = '';
        hero.style.zIndex = '';
      }, 380);
    }
    document.querySelectorAll('.ww-profile-item').forEach(el => {
      el.classList.remove('ww-dim-item');
    });
    if (wwSelectTitle) wwSelectTitle.classList.remove('ww-fade-element');
    if (wwSelectSub) wwSelectSub.classList.remove('ww-fade-element');
    if (wwMainActions) wwMainActions.classList.remove('ww-fade-element');

    isHeroPinActive = false;
    pendingPinProfile = null;
    pendingPinHeroItem = null;
  }

  async function submitHeroPin(enteredPin) {
    if (!pendingPinProfile || !pendingPinHeroItem) return;
    const targetProfile = pendingPinProfile;
    const targetItem = pendingPinHeroItem;

    try {
      const activeP = profilesData.find(p => p.id === currentActiveId);
      const isExitingKids = Boolean(activeP && activeP.is_kids && !targetProfile.is_kids);

      const payload = { pin: enteredPin };
      if (isExitingKids && !targetProfile.has_pin) {
        const lockedAdult = profilesData.find(p => !p.is_kids && p.has_pin);
        if (lockedAdult) payload.authProfileId = lockedAdult.id;
      }

      const res = await fetch(`/api/profiles/${targetProfile.id}/switch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        const data = await res.json();
        isSwitchingProfile = true;
        currentActiveId = targetProfile.id;

        if (wwPinPrompt) {
          wwPinPrompt.style.opacity = '0';
          setTimeout(() => { wwPinPrompt.hidden = true; }, 250);
        }

        // Center hero completion transition (matching Netflix slide & load)
        if (targetItem) {
          const deltaX = Number(targetItem.dataset.heroDeltaX || 0);
          const itemCenterY = Number(targetItem.dataset.itemCenterY || (window.innerHeight / 2));
          const finalDeltaY = Math.round((window.innerHeight / 2) - itemCenterY);
          targetItem.style.transition = 'transform 0.44s cubic-bezier(0.16, 1, 0.3, 1)';
          targetItem.style.transform = `translate3d(${deltaX}px, ${finalDeltaY}px, 0) scale(1.35)`;
        }

        const navImg = document.getElementById('nav-profile-avatar-img');
        if (navImg && data.profile && data.profile.avatar) {
          navImg.src = data.profile.avatar;
        }
        const settingsName = document.querySelector('.s-settings-user-name');
        if (settingsName && data.profile && data.profile.name) {
          settingsName.textContent = data.profile.name;
        }

        setTimeout(() => {
          if (wwModal) wwModal.classList.add('ww-modal-exiting');
          setTimeout(() => {
            closeWhosWatching();
            delete document.body.dataset.showWhosWatching;
            document.body.classList.remove('ww-active');
            isSwitchingProfile = false;
            isHeroPinActive = false;
            pendingPinProfile = null;
            pendingPinHeroItem = null;
            window.location.href = window.location.pathname;
          }, 350);
        }, 420);
      } else {
        const errData = await res.json().catch(() => ({}));
        if (wwPinBoxes) {
          wwPinBoxes.classList.remove('pin-shake');
          void wwPinBoxes.offsetWidth;
          wwPinBoxes.classList.add('pin-shake');
        }
        if (wwPinError) {
          wwPinError.textContent = errData.error || 'Incorrect PIN. Try again.';
          wwPinError.style.display = 'block';
        }
        if (wwPinDigits) {
          wwPinDigits.forEach(i => { i.value = ''; });
          setTimeout(() => {
            if (wwPinDigits[0]) wwPinDigits[0].focus();
          }, 250);
        }
      }
    } catch (err) {
      console.error('Error verifying PIN:', err);
    }
  }

  function resetProfileSelectionAnimations() {
    document.querySelectorAll('.ww-profile-item').forEach(el => {
      el.classList.remove('selected-hero', 'ww-dim-item');
      el.style.transform = '';
      el.style.transition = '';
      el.style.zIndex = '';
      el.style.opacity = '';
    });
    if (wwSelectTitle) wwSelectTitle.classList.remove('ww-fade-element');
    if (wwSelectSub) wwSelectSub.classList.remove('ww-fade-element');
    if (wwMainActions) wwMainActions.classList.remove('ww-fade-element');
    if (wwPinPrompt) {
      wwPinPrompt.hidden = true;
      wwPinPrompt.style.opacity = '1';
    }
    if (wwModal) wwModal.classList.remove('ww-modal-exiting');
    isHeroPinActive = false;
    pendingPinProfile = null;
    pendingPinHeroItem = null;
  }

  async function switchProfile(id, clickedItem = null) {
    if (isSwitchingProfile || isHeroPinActive) return;
    const targetProfile = profilesData.find(p => p.id === Number(id));
    const activeP = profilesData.find(p => p.id === currentActiveId);

    // If active profile is kids and target is adult, require PIN
    if (activeP && activeP.is_kids && targetProfile && !targetProfile.is_kids) {
      const itemEl = clickedItem || document.querySelector(`.ww-profile-item[data-id="${id}"]`);
      if (itemEl && targetProfile) {
        startHeroPinChallenge(targetProfile, itemEl, true);
        return;
      }
    }

    // If target profile is locked with PIN, require PIN
    if (targetProfile && targetProfile.has_pin) {
      const itemEl = clickedItem || document.querySelector(`.ww-profile-item[data-id="${id}"]`);
      if (itemEl) {
        startHeroPinChallenge(targetProfile, itemEl, false);
        return;
      }
    }

    try {
      isSwitchingProfile = true;
      const isAlreadyActive = Number(id) === Number(currentActiveId);

      const targetEl = clickedItem || document.querySelector(`.ww-profile-item[data-id="${id}"]`);
      if (targetEl) {
        const itemRect = targetEl.getBoundingClientRect();
        const itemCenterX = itemRect.left + itemRect.width / 2;
        const itemCenterY = itemRect.top + itemRect.height / 2;
        const viewportCenterX = window.innerWidth / 2;
        const viewportCenterY = window.innerHeight / 2;
        const deltaX = Math.round(viewportCenterX - itemCenterX);
        const deltaY = Math.round(viewportCenterY - itemCenterY);

        targetEl.classList.add('selected-hero');
        targetEl.style.zIndex = '9999';
        targetEl.style.transition = 'transform 0.44s cubic-bezier(0.16, 1, 0.3, 1)';
        targetEl.style.transform = `translate3d(${deltaX}px, ${deltaY}px, 0) scale(1.25)`;

        document.querySelectorAll('.ww-profile-item').forEach(el => {
          if (el !== targetEl) el.classList.add('ww-dim-item');
        });
        if (wwSelectTitle) wwSelectTitle.classList.add('ww-fade-element');
        if (wwSelectSub) wwSelectSub.classList.add('ww-fade-element');
        if (wwMainActions) wwMainActions.classList.add('ww-fade-element');
      }

      const res = await fetch(`/api/profiles/${id}/switch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      if (res.ok) {
        const data = await res.json();
        currentActiveId = id;

        const navImg = document.getElementById('nav-profile-avatar-img');
        if (navImg && data.profile && data.profile.avatar) {
          navImg.src = data.profile.avatar;
        }
        const settingsName = document.querySelector('.s-settings-user-name');
        if (settingsName && data.profile && data.profile.name) {
          settingsName.textContent = data.profile.name;
        }

        setTimeout(() => {
          if (wwModal) wwModal.classList.add('ww-modal-exiting');
          setTimeout(() => {
            closeWhosWatching();
            delete document.body.dataset.showWhosWatching;
            document.body.classList.remove('ww-active');
            isSwitchingProfile = false;

            if (!isAlreadyActive) {
              window.location.href = window.location.pathname;
            } else {
              resetProfileSelectionAnimations();
            }
          }, 350);
        }, 420);
      } else {
        isSwitchingProfile = false;
        resetProfileSelectionAnimations();
      }
    } catch (e) {
      console.error('Error switching profile:', e);
      isSwitchingProfile = false;
      resetProfileSelectionAnimations();
    }
  }

  function getPresetByPath(path) {
    return presetsList.find(p => p.path === path) || { id: '', name: 'Classic Icon', path };
  }

  function renderAvatarGrid(filterQuery = '') {
    if (!wwAvatarGrid) return;
    wwAvatarGrid.innerHTML = '';
    const q = filterQuery.toLowerCase();
    const filtered = presetsList.filter(p => !q || p.name.toLowerCase().includes(q));

    filtered.forEach(preset => {
      const tile = document.createElement('div');
      tile.className = 'ww-avatar-tile' + (preset.path === selectedAvatar ? ' selected' : '');
      tile.title = preset.name;
      tile.innerHTML = `<img src="${preset.path}" alt="${preset.name}">`;

      tile.addEventListener('click', () => {
        selectedAvatar = preset.path;
        if (wwFormPreviewImg) wwFormPreviewImg.src = preset.path;
        if (wwFormPreviewName) wwFormPreviewName.textContent = preset.name;
        wwAvatarGrid.querySelectorAll('.ww-avatar-tile').forEach(t => t.classList.remove('selected'));
        tile.classList.add('selected');
      });

      wwAvatarGrid.appendChild(tile);
    });
  }

  function switchView(targetView) {
    [wwViewSelect, wwViewForm].forEach(v => {
      if (v) {
        if (v === targetView) {
          v.hidden = false;
          v.classList.remove('ww-view-fade-in');
          void v.offsetWidth;
          v.classList.add('ww-view-fade-in');
        } else {
          v.hidden = true;
          v.classList.remove('ww-view-fade-in');
        }
      }
    });
  }

  function openAddProfileForm() {
    const previewBox = document.querySelector('.ww-avatar-preview-box');
    const formMain = document.querySelector('.ww-form-main');
    if (previewBox) {
      previewBox.style.transform = '';
      previewBox.style.transition = '';
      previewBox.style.zIndex = '';
      previewBox.style.boxShadow = '';
    }
    if (formMain) {
      formMain.style.opacity = '';
      formMain.style.transition = '';
    }
    if (wwFormPreviewName) {
      wwFormPreviewName.style.opacity = '';
      wwFormPreviewName.style.transition = '';
    }

    if (wwFormHeading) wwFormHeading.textContent = 'Add Profile';
    if (wwEditId) wwEditId.value = '';
    if (wwProfileName) {
      wwProfileName.value = '';
      if (wwCharCount) wwCharCount.textContent = '0/20';
    }
    if (wwIsKids) wwIsKids.checked = false;
    if (wwKidsLockNotice) wwKidsLockNotice.style.display = 'none';
    if (wwLockPin) {
      wwLockPin.checked = false;
      wwLockPin.disabled = false;
    }
    if (wwPinFormGroup) wwPinFormGroup.style.display = 'none';
    if (wwOldPinRow) wwOldPinRow.style.display = 'none';
    if (wwNewPinRow) wwNewPinRow.style.display = 'block';
    if (wwPinInputLabel) wwPinInputLabel.textContent = 'Enter 4-Digit PIN';
    if (wwPinInput) wwPinInput.value = '';
    if (wwOldPinInput) wwOldPinInput.value = '';
    if (wwPinChangeBtn) wwPinChangeBtn.style.display = 'none';
    if (wwPinStatusText) wwPinStatusText.textContent = '';
    if (wwPinFormError) wwPinFormError.style.display = 'none';

    // Default avatar
    const defaultPreset = presetsList[1] || presetsList[0];
    selectedAvatar = defaultPreset ? defaultPreset.path : '/profiles/avatars/blue-classic-icon.svg';
    if (wwFormPreviewImg) wwFormPreviewImg.src = selectedAvatar;
    if (wwFormPreviewName) wwFormPreviewName.textContent = defaultPreset ? defaultPreset.name : 'Blue Classic Icon';

    if (wwAvatarSearchInput) wwAvatarSearchInput.value = '';
    renderAvatarGrid('');

    if (wwDeleteBtn) wwDeleteBtn.hidden = true;
    switchView(wwViewForm);
    if (wwProfileName) wwProfileName.focus();
  }

  function openEditProfileForm(profile) {
    const previewBox = document.querySelector('.ww-avatar-preview-box');
    const formMain = document.querySelector('.ww-form-main');
    if (previewBox) {
      previewBox.style.transform = '';
      previewBox.style.transition = '';
      previewBox.style.zIndex = '';
      previewBox.style.boxShadow = '';
    }
    if (formMain) {
      formMain.style.opacity = '';
      formMain.style.transition = '';
    }
    if (wwFormPreviewName) {
      wwFormPreviewName.style.opacity = '';
      wwFormPreviewName.style.transition = '';
    }

    if (wwFormHeading) wwFormHeading.textContent = 'Edit Profile';
    if (wwEditId) wwEditId.value = profile.id;
    if (wwProfileName) {
      wwProfileName.value = profile.name;
      if (wwCharCount) wwCharCount.textContent = `${profile.name.length}/20`;
    }
    if (wwKidsLockNotice) wwKidsLockNotice.style.display = 'none';
    if (wwIsKids) wwIsKids.checked = !!profile.is_kids;
    const hasPin = Boolean(profile.has_pin);
    const isCurrentActive = (Number(currentActiveId) === Number(profile.id));

    if (wwPinInput) wwPinInput.value = '';
    if (wwOldPinInput) wwOldPinInput.value = '';
    if (wwPinFormError) wwPinFormError.style.display = 'none';

    if (hasPin) {
      wwLockPin.checked = true;
      if (isCurrentActive) {
        wwLockPin.disabled = false;
        if (wwPinFormGroup) wwPinFormGroup.style.display = 'none';
        if (wwPinChangeBtn) wwPinChangeBtn.style.display = 'inline-block';
        if (wwPinStatusText) wwPinStatusText.textContent = 'Profile is locked with a PIN.';
      } else {
        wwLockPin.disabled = true;
        if (wwPinFormGroup) wwPinFormGroup.style.display = 'none';
        if (wwPinChangeBtn) wwPinChangeBtn.style.display = 'none';
        if (wwPinStatusText) wwPinStatusText.textContent = 'Locked with PIN. Switch to this profile to change or remove its PIN.';
      }
    } else {
      wwLockPin.checked = false;
      wwLockPin.disabled = false;
      if (wwPinFormGroup) wwPinFormGroup.style.display = 'none';
      if (wwPinChangeBtn) wwPinChangeBtn.style.display = 'none';
      if (wwPinStatusText) wwPinStatusText.textContent = '';
    }

    selectedAvatar = profile.avatar;
    const preset = getPresetByPath(selectedAvatar);
    if (wwFormPreviewImg) wwFormPreviewImg.src = selectedAvatar;
    if (wwFormPreviewName) wwFormPreviewName.textContent = preset.name;

    if (wwAvatarSearchInput) wwAvatarSearchInput.value = '';
    renderAvatarGrid('');

    if (wwDeleteBtn) wwDeleteBtn.hidden = profilesData.length <= 1;
    switchView(wwViewForm);
    if (wwProfileName) wwProfileName.focus();
  }

  function openWhosWatching() {
    if (!wwModal) return;
    isManageMode = false;
    isSwitchingProfile = false;
    pendingPinProfile = null;
    resetProfileSelectionAnimations();
    if (wwSelectTitle) wwSelectTitle.textContent = "Who's watching?";
    if (wwSelectSub) wwSelectSub.textContent = '';
    if (wwManageBtn) wwManageBtn.textContent = 'MANAGE PROFILES';
    const isMandatory = document.body.dataset.showWhosWatching === 'true';
    if (wwCancelBtn) {
      wwCancelBtn.hidden = isMandatory;
      wwCancelBtn.style.display = isMandatory ? 'none' : '';
    }
    if (wwViewSelect) wwViewSelect.hidden = false;
    if (wwViewForm) wwViewForm.hidden = true;
    wwModal.hidden = false;
    document.body.style.overflow = 'hidden';
    loadProfiles();
  }

  function closeWhosWatching() {
    if (window.location.pathname === '/whos-watching') {
      const params = new URLSearchParams(window.location.search);
      window.location.href = params.get('next') || '/';
      return;
    }
    if (!wwModal) return;
    wwModal.hidden = true;
    document.body.style.overflow = '';
    isManageMode = false;
    isSwitchingProfile = false;
    pendingPinProfile = null;
    delete document.body.dataset.showWhosWatching;
    resetProfileSelectionAnimations();

    if (window.location.search.includes('whosWatching')) {
      const urlParams = new URLSearchParams(window.location.search);
      urlParams.delete('whosWatching');
      const cleanUrl = window.location.pathname + (urlParams.toString() ? '?' + urlParams.toString() : '') + window.location.hash;
      window.history.replaceState({}, document.title, cleanUrl);
    }
  }

  if (wwBtn) {
    wwBtn.addEventListener('click', openWhosWatching);
  }
  if (wwCancelBtn) {
    wwCancelBtn.addEventListener('click', closeWhosWatching);
  }
  if (wwManageBtn) {
    wwManageBtn.addEventListener('click', () => {
      isManageMode = !isManageMode;
      if (wwSelectTitle) wwSelectTitle.textContent = isManageMode ? 'Manage Profiles' : "Who's watching?";
      if (wwSelectSub) wwSelectSub.textContent = '';
      wwManageBtn.textContent = isManageMode ? 'DONE' : 'MANAGE PROFILES';
      const isMandatory = document.body.dataset.showWhosWatching === 'true';
      if (wwCancelBtn) {
        wwCancelBtn.hidden = isManageMode || isMandatory;
        wwCancelBtn.style.display = (isManageMode || isMandatory) ? 'none' : '';
      }
      renderProfiles();
    });
  }
  if (wwFormCancel) {
    wwFormCancel.addEventListener('click', () => {
      if (wwViewForm) wwViewForm.hidden = true;
      if (wwViewSelect) wwViewSelect.hidden = false;
    });
  }
  if (wwProfileName) {
    wwProfileName.addEventListener('input', () => {
      if (wwCharCount) wwCharCount.textContent = `${wwProfileName.value.length}/20`;
    });
  }
  if (wwAvatarSearchInput) {
    wwAvatarSearchInput.addEventListener('input', (e) => {
      renderAvatarGrid(e.target.value.trim());
    });
  }

  // Kids Profile Toggle
  if (wwIsKids) {
    wwIsKids.addEventListener('change', () => {
      if (wwIsKids.checked) {
        const editNum = wwEditId && wwEditId.value ? Number(wwEditId.value) : null;
        if (!hasLockedAdultProfile(editNum)) {
          wwIsKids.checked = false;
          if (wwKidsLockNotice) {
            wwKidsLockNotice.textContent = 'An adult profile must have a PIN lock first before creating or enabling a Kids profile.';
            wwKidsLockNotice.style.display = 'block';
            setTimeout(() => {
              if (wwKidsLockNotice) wwKidsLockNotice.style.display = 'none';
            }, 4500);
          }
        } else {
          if (wwKidsLockNotice) wwKidsLockNotice.style.display = 'none';
        }
      } else {
        if (wwKidsLockNotice) wwKidsLockNotice.style.display = 'none';
      }
    });
  }

  // Lock PIN Toggle & Change PIN button
  if (wwLockPin) {
    wwLockPin.addEventListener('change', () => {
      const editId = wwEditId && wwEditId.value ? Number(wwEditId.value) : null;
      const existing = editId ? profilesData.find(p => p.id === editId) : null;
      const hadPin = Boolean(existing && existing.has_pin);

      if (wwLockPin.checked) {
        if (hadPin) {
          if (wwPinFormGroup) wwPinFormGroup.style.display = 'none';
          if (wwPinChangeBtn) wwPinChangeBtn.style.display = 'inline-block';
          if (wwPinStatusText) wwPinStatusText.textContent = 'Profile is locked with a PIN.';
          if (wwOldPinRow) wwOldPinRow.style.display = 'none';
          if (wwNewPinRow) wwNewPinRow.style.display = 'block';
          if (wwOldPinInput) wwOldPinInput.value = '';
          if (wwPinInput) wwPinInput.value = '';
          if (wwPinFormError) wwPinFormError.style.display = 'none';
        } else {
          if (wwPinFormGroup) wwPinFormGroup.style.display = 'block';
          if (wwOldPinRow) wwOldPinRow.style.display = 'none';
          if (wwNewPinRow) wwNewPinRow.style.display = 'block';
          if (wwPinInputLabel) wwPinInputLabel.textContent = 'Enter 4-Digit PIN';
          if (wwPinChangeBtn) wwPinChangeBtn.style.display = 'none';
          if (wwPinStatusText) wwPinStatusText.textContent = '';
          if (wwPinInput) {
            wwPinInput.value = '';
            wwPinInput.focus();
          }
        }
      } else {
        if (hadPin) {
          // Turning off existing PIN lock: prompt for current PIN
          if (wwPinFormGroup) wwPinFormGroup.style.display = 'block';
          if (wwOldPinRow) wwOldPinRow.style.display = 'block';
          if (wwNewPinRow) wwNewPinRow.style.display = 'none';
          if (wwPinChangeBtn) wwPinChangeBtn.style.display = 'none';
          if (wwPinStatusText) wwPinStatusText.textContent = 'Enter your current PIN to turn off lock.';
          if (wwOldPinInput) {
            wwOldPinInput.value = '';
            wwOldPinInput.focus();
          }
        } else {
          if (wwPinFormGroup) wwPinFormGroup.style.display = 'none';
          if (wwPinChangeBtn) wwPinChangeBtn.style.display = 'none';
          if (wwPinInput) wwPinInput.value = '';
          if (wwOldPinInput) wwOldPinInput.value = '';
          if (wwPinStatusText) wwPinStatusText.textContent = '';
          if (wwPinFormError) wwPinFormError.style.display = 'none';
        }
      }
    });
  }

  if (wwPinChangeBtn) {
    wwPinChangeBtn.addEventListener('click', () => {
      if (wwPinFormGroup) wwPinFormGroup.style.display = 'block';
      if (wwOldPinRow) wwOldPinRow.style.display = 'block';
      if (wwNewPinRow) wwNewPinRow.style.display = 'block';
      if (wwPinInputLabel) wwPinInputLabel.textContent = 'New 4-Digit PIN';
      if (wwPinChangeBtn) wwPinChangeBtn.style.display = 'none';
      if (wwPinStatusText) wwPinStatusText.textContent = 'Enter current and new PIN to update.';
      if (wwOldPinInput) {
        wwOldPinInput.value = '';
        wwOldPinInput.focus();
      }
      if (wwPinInput) wwPinInput.value = '';
    });
  }

  // Seamless Hero PIN digits inputs (auto-focus, paste, auto-submit)
  if (wwPinDigits && wwPinDigits.length) {
    wwPinDigits.forEach((digitInput, idx) => {
      digitInput.addEventListener('input', () => {
        const val = digitInput.value.replace(/\D/g, '');
        digitInput.value = val ? val[val.length - 1] : '';
        if (digitInput.value && idx < wwPinDigits.length - 1) {
          wwPinDigits[idx + 1].focus();
        }
        const enteredPin = Array.from(wwPinDigits).map(i => i.value).join('');
        if (enteredPin.length === 4 && pendingPinProfile) {
          submitHeroPin(enteredPin);
        }
      });

      digitInput.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !digitInput.value && idx > 0) {
          wwPinDigits[idx - 1].focus();
        } else if (e.key === 'ArrowLeft' && idx > 0) {
          wwPinDigits[idx - 1].focus();
        } else if (e.key === 'ArrowRight' && idx < wwPinDigits.length - 1) {
          wwPinDigits[idx + 1].focus();
        }
      });

      digitInput.addEventListener('paste', (e) => {
        e.preventDefault();
        const pasted = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '').slice(0, 4);
        if (!pasted) return;
        pasted.split('').forEach((char, i) => {
          if (wwPinDigits[i]) wwPinDigits[i].value = char;
        });
        if (pasted.length === 4 && pendingPinProfile) {
          submitHeroPin(pasted);
        } else if (wwPinDigits[pasted.length]) {
          wwPinDigits[pasted.length].focus();
        }
      });
    });
  }

  if (wwPinCancelBtn) {
    wwPinCancelBtn.addEventListener('click', cancelHeroPinChallenge);
  }

  if (wwProfileForm) {
    wwProfileForm.addEventListener('submit', async e => {
      e.preventDefault();
      const name = (wwProfileName ? wwProfileName.value : '').trim();
      if (!name) return;
      const isKids = wwIsKids ? (wwIsKids.checked ? 1 : 0) : 0;
      const editId = wwEditId ? wwEditId.value : '';
      const existing = editId ? profilesData.find(p => p.id === Number(editId)) : null;
      const hadPin = Boolean(existing && existing.has_pin);
      const lockPinChecked = wwLockPin ? wwLockPin.checked : false;
      const enteredNewPin = wwPinInput ? wwPinInput.value.trim() : '';
      const enteredOldPin = wwOldPinInput ? wwOldPinInput.value.trim() : '';

      if (isKids) {
        const editNum = editId ? Number(editId) : null;
        if (!hasLockedAdultProfile(editNum)) {
          if (wwKidsLockNotice) {
            wwKidsLockNotice.textContent = 'An adult profile must have a PIN lock first before creating or enabling a Kids profile.';
            wwKidsLockNotice.style.display = 'block';
          }
          return;
        }
      }

      if (wwPinFormError) wwPinFormError.style.display = 'none';

      let pinVal = undefined;
      let removePin = false;
      let oldPinVal = undefined;

      if (hadPin) {
        if (!lockPinChecked) {
          // Turning off lock: current PIN required
          if (!enteredOldPin || !/^\d{4}$/.test(enteredOldPin)) {
            if (wwPinFormError) {
              wwPinFormError.textContent = 'Enter your current 4-digit PIN to turn off lock.';
              wwPinFormError.style.display = 'block';
            }
            if (wwOldPinInput) wwOldPinInput.focus();
            return;
          }
          removePin = true;
          oldPinVal = enteredOldPin;
        } else if (enteredNewPin || enteredOldPin) {
          // Changing PIN: both old and new PIN required
          if (!enteredOldPin || !/^\d{4}$/.test(enteredOldPin)) {
            if (wwPinFormError) {
              wwPinFormError.textContent = 'Current 4-digit PIN is required.';
              wwPinFormError.style.display = 'block';
            }
            if (wwOldPinInput) wwOldPinInput.focus();
            return;
          }
          if (!enteredNewPin || !/^\d{4}$/.test(enteredNewPin)) {
            if (wwPinFormError) {
              wwPinFormError.textContent = 'New PIN must be exactly 4 digits.';
              wwPinFormError.style.display = 'block';
            }
            if (wwPinInput) wwPinInput.focus();
            return;
          }
          pinVal = enteredNewPin;
          oldPinVal = enteredOldPin;
        }
      } else {
        if (lockPinChecked) {
          if (!enteredNewPin || !/^\d{4}$/.test(enteredNewPin)) {
            if (wwPinFormError) {
              wwPinFormError.textContent = 'Please enter a 4-digit PIN for the profile.';
              wwPinFormError.style.display = 'block';
            }
            if (wwPinInput) {
              if (wwPinFormGroup) wwPinFormGroup.style.display = 'block';
              wwPinInput.focus();
            }
            return;
          }
          pinVal = enteredNewPin;
        }
      }

      const payload = {
        name,
        avatar: selectedAvatar,
        is_kids: isKids
      };
      if (pinVal) payload.pin = pinVal;
      if (removePin) payload.remove_pin = true;
      if (oldPinVal) payload.old_pin = oldPinVal;

      try {
        let res;
        if (editId) {
          res = await fetch(`/api/profiles/${editId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
        } else {
          res = await fetch('/api/profiles', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
        }
        if (res.ok) {
          const savedData = await res.json();
          if (!editId && savedData && savedData.id) {
            // Activate newly created profile in session
            const switchPromise = fetch(`/api/profiles/${savedData.id}/switch`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ pin: pinVal || '' })
            });

            // Smooth center hero transition for the new profile
            const previewBox = document.querySelector('.ww-avatar-preview-box');
            const formMain = document.querySelector('.ww-form-main');
            const previewName = document.getElementById('ww-form-preview-name');

            if (formMain) {
              formMain.style.transition = 'opacity 0.25s ease';
              formMain.style.opacity = '0';
            }
            if (previewName) {
              previewName.style.transition = 'opacity 0.25s ease';
              previewName.style.opacity = '0';
            }

            if (previewBox) {
              const rect = previewBox.getBoundingClientRect();
              const currentCenterX = rect.left + rect.width / 2;
              const currentCenterY = rect.top + rect.height / 2;
              const viewportCenterX = window.innerWidth / 2;
              const viewportCenterY = window.innerHeight / 2;
              const deltaX = Math.round(viewportCenterX - currentCenterX);
              const deltaY = Math.round(viewportCenterY - currentCenterY);

              previewBox.style.zIndex = '9999';
              previewBox.style.transition = 'transform 0.44s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.44s ease';
              previewBox.style.transform = `translate3d(${deltaX}px, ${deltaY}px, 0) scale(1.25)`;
              previewBox.style.boxShadow = '0 24px 60px rgba(0, 0, 0, 0.9), 0 0 35px rgba(245, 179, 1, 0.45)';
            }

            const navImg = document.getElementById('nav-profile-avatar-img');
            if (navImg && savedData.avatar) {
              navImg.src = savedData.avatar;
            }
            const settingsName = document.querySelector('.s-settings-user-name');
            if (settingsName && savedData.name) {
              settingsName.textContent = savedData.name;
            }

            await switchPromise;

            setTimeout(() => {
              if (wwModal) wwModal.classList.add('ww-modal-exiting');
              setTimeout(() => {
                closeWhosWatching();
                delete document.body.dataset.showWhosWatching;
                document.body.classList.remove('ww-active');
                window.location.href = window.location.pathname;
              }, 350);
            }, 420);
            return;
          }
          await loadProfiles();
          switchView(wwViewSelect);
        } else {
          const errData = await res.json().catch(() => ({}));
          if (wwPinFormError) {
            wwPinFormError.textContent = errData.error || 'Failed to save profile.';
            wwPinFormError.style.display = 'block';
          }
        }
      } catch (err) {
        console.error('Error saving profile:', err);
      }
    });
  }

  // Themed Custom Delete Confirmation Modal
  if (wwDeleteBtn) {
    wwDeleteBtn.addEventListener('click', () => {
      const editId = wwEditId ? wwEditId.value : '';
      if (!editId) return;
      const targetProfile = profilesData.find(p => p.id === Number(editId));
      if (targetProfile) {
        const deleteAvatarImg = document.getElementById('ww-delete-dialog-avatar');
        if (deleteAvatarImg) deleteAvatarImg.src = targetProfile.avatar;
        const deleteNameEl = document.getElementById('ww-delete-dialog-name');
        if (deleteNameEl) {
          deleteNameEl.textContent = targetProfile.name;
        } else if (wwDeleteDialogTitle) {
          wwDeleteDialogTitle.textContent = `Delete ${targetProfile.name}?`;
        }
      }
      if (wwDeleteDialog) wwDeleteDialog.hidden = false;
    });
  }

  if (wwDeleteCancelBtn) {
    wwDeleteCancelBtn.addEventListener('click', () => {
      if (wwDeleteDialog) wwDeleteDialog.hidden = true;
    });
  }

  if (wwDeleteConfirmBtn) {
    wwDeleteConfirmBtn.addEventListener('click', async () => {
      const editId = wwEditId ? wwEditId.value : '';
      if (!editId) return;
      try {
        const res = await fetch(`/api/profiles/${editId}`, { method: 'DELETE' });
        if (res.ok) {
          if (wwDeleteDialog) wwDeleteDialog.hidden = true;
          await loadProfiles();
          switchView(wwViewSelect);
        } else {
          const errData = await res.json().catch(() => ({}));
          if (wwDeleteDialog) wwDeleteDialog.hidden = true;
          if (wwPinFormError) {
            wwPinFormError.textContent = errData.error || 'Failed to delete profile.';
            wwPinFormError.style.display = 'block';
          }
        }
      } catch (err) {
        console.error('Error deleting profile:', err);
      }
    });
  }

  // Handle standalone "/whos-watching" page vs. modal mode
  const isStandalonePage = window.location.pathname === '/whos-watching';
  if (isStandalonePage) {
    if (wwModal) wwModal.hidden = false;
    isManageMode = false;
    loadProfiles();
  } else {
    // Auto-open "Who's watching?" modal on regular site pages if requested
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('whosWatching') || document.body.dataset.showWhosWatching === 'true') {
      openWhosWatching();
      if (urlParams.has('whosWatching')) {
        urlParams.delete('whosWatching');
        const cleanUrl = window.location.pathname + (urlParams.toString() ? '?' + urlParams.toString() : '') + window.location.hash;
        window.history.replaceState({}, document.title, cleanUrl);
      }
    }
  }

  // Settings Dropdown Toggle (Images 1 & 2)
  const settingsBtn = document.getElementById('btn-settings-toggle');
  const settingsMenu = document.getElementById('s-settings-menu');

  if (settingsBtn && settingsMenu) {
    settingsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isHidden = settingsMenu.hidden;
      settingsMenu.hidden = !isHidden;
      settingsBtn.setAttribute('aria-expanded', isHidden ? 'true' : 'false');
    });

    document.addEventListener('click', (e) => {
      if (!settingsMenu.hidden && !settingsMenu.contains(e.target) && !settingsBtn.contains(e.target)) {
        settingsMenu.hidden = true;
        settingsBtn.setAttribute('aria-expanded', 'false');
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (wwDeleteDialog && !wwDeleteDialog.hidden) {
          wwDeleteDialog.hidden = true;
          e.stopPropagation();
          return;
        }
        if (isHeroPinActive) {
          cancelHeroPinChallenge();
          e.stopPropagation();
          return;
        }
        if (!settingsMenu.hidden) {
          settingsMenu.hidden = true;
          settingsBtn.setAttribute('aria-expanded', 'false');
        } else if (wwModal && !wwModal.hidden) {
          if (wwViewForm && !wwViewForm.hidden) {
            switchView(wwViewSelect);
          } else if (document.body.dataset.showWhosWatching !== 'true') {
            closeWhosWatching();
          }
        }
      }
    });
  }

  // "Show ads" Toggle
  const adsToggle = document.getElementById('toggle-show-ads');
  if (adsToggle) {
    adsToggle.checked = localStorage.getItem('cinebase.showAds') === 'true';
    adsToggle.addEventListener('change', () => {
      localStorage.setItem('cinebase.showAds', adsToggle.checked);
    });
  }

  // Watch Party Modal
  const wpBtn = document.getElementById('btn-watch-party');
  const wpModal = document.getElementById('watchparty-modal');
  const wpClose = document.getElementById('btn-close-watchparty');
  const wpRoomLink = document.getElementById('wp-room-link');
  const wpCopyBtn = document.getElementById('btn-wp-copy');
  const wpCopiedMsg = document.getElementById('wp-copied-msg');

  if (wpBtn && wpModal) {
    wpBtn.addEventListener('click', () => {
      if (settingsMenu) {
        settingsMenu.hidden = true;
        settingsBtn?.setAttribute('aria-expanded', 'false');
      }
      const roomCode = Math.random().toString(36).substring(2, 9);
      const link = window.location.origin + window.location.pathname + '?party=' + roomCode;
      if (wpRoomLink) wpRoomLink.value = link;
      if (wpCopiedMsg) wpCopiedMsg.hidden = true;
      wpModal.hidden = false;
      document.body.style.overflow = 'hidden';
    });
  }

  if (wpClose && wpModal) {
    wpClose.addEventListener('click', () => {
      wpModal.hidden = true;
      document.body.style.overflow = '';
    });
  }

  if (wpCopyBtn && wpRoomLink) {
    wpCopyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(wpRoomLink.value);
        if (wpCopiedMsg) {
          wpCopiedMsg.hidden = false;
          setTimeout(() => { if (wpCopiedMsg) wpCopiedMsg.hidden = true; }, 3000);
        }
      } catch (err) {
        wpRoomLink.select();
        document.execCommand('copy');
        if (wpCopiedMsg) {
          wpCopiedMsg.hidden = false;
          setTimeout(() => { if (wpCopiedMsg) wpCopiedMsg.hidden = true; }, 3000);
        }
      }
    });
  }

  // Netflix-style hover preview: hovering a poster opens a larger card that plays the trailer muted.
  // Mouse/trackpad only, and off for people who prefer reduced motion.
  const mq = q => !!window.matchMedia?.(q).matches;
  if (mq('(hover: hover) and (pointer: fine)') && !mq('(prefers-reduced-motion: reduce)')) {
    const OPEN_DELAY = 600, CLOSE_DELAY = 180;
    const trailers = new Map(); // "movie:27205" -> YouTube key | null
    let openTimer, closeTimer, current = null, pv = null, req = 0;

    const mk = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
    // Smaller TMDB backdrop for the card; fetched as soon as the hover starts
    const pvImg = card => (card.dataset.pvImg || '').replace('/t/p/w1280/', '/t/p/w780/');
    const ytCommand = (frame, func) => frame?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args: [] }), 'https://www.youtube-nocookie.com');

    async function trailerFor(card) {
      if (card.dataset.pvYt) return card.dataset.pvYt;
      const { pvMedia: media, pvId: id } = card.dataset;
      if (!id) return null;
      const key = `${media}:${id}`;
      if (!trailers.has(key)) {
        try {
          const r = await fetch(`/preview/${media}/${id}`);
          trailers.set(key, r.ok ? (await r.json()).trailer : null);
        } catch { return null; }
      }
      return trailers.get(key);
    }

    // Close with the reverse morph back into the poster (or instantly, e.g. on scroll)
    function closePreview(instant = false) {
      clearTimeout(openTimer);
      current = null;
      if (!pv) return;
      const old = pv;
      pv = null;
      const done = () => { old.remove(); old._card?.classList.remove('pv-open'); };
      if (instant === true) return done();
      old.classList.remove('in');
      setTimeout(done, 320);
    }

    async function openPreview(card) {
      const myReq = ++req;
      if (pv) { pv.remove(); pv._card?.classList.remove('pv-open'); pv = null; }
      current = card;
      card.classList.add('pv-open'); // drop the poster's own hover lift so the morph starts from its real box
      const href = card.getAttribute('href');
      const poster = card.querySelector('.poster') || card;
      const pr = poster.getBoundingClientRect();
      const width = Math.min(Math.max(pr.width * 1.9, 300), 420);
      const left = Math.min(Math.max(pr.left + pr.width / 2 - width / 2, 8), innerWidth - width - 8);

      pv = mk('div', 'pv');
      pv._card = card;
      pv.style.width = `${width}px`;
      pv.style.left = `${left}px`;
      const inner = mk('div', 'pv-inner');
      const media = mk('div', 'pv-media');
      // Blurred poster fills the frame instantly; the backdrop fades in over it once loaded
      const posterSrc = poster.querySelector('img')?.currentSrc;
      if (posterSrc) { const blur = mk('img', 'pv-blur'); blur.src = posterSrc; blur.alt = ''; media.append(blur); }
      if (pvImg(card)) {
        const bg = mk('img', 'pv-bg');
        bg.alt = '';
        bg.addEventListener('load', () => bg.classList.add('on'));
        bg.src = pvImg(card);
        if (bg.complete) bg.classList.add('on');
        media.append(bg);
      }
      const body = mk('div', 'pv-body');
      const cta = mk('div', 'pv-cta');
      const playBtn = mk('a', 'sbtn sbtn-play', '▶ Play'); playBtn.href = `${href}#watch`;
      const info = mk('a', 'sbtn sbtn-glass', 'More info'); info.href = href;
      cta.append(playBtn, info);
      body.append(mk('b', null, card.dataset.pvTitle), mk('small', null, card.dataset.pvMeta), cta);
      // A copy of the poster sits exactly over the real one and fades out as the card opens
      const ghost = poster.cloneNode(true);
      ghost.className = 'poster pv-ghost';
      inner.append(media, body, ghost);
      pv.append(inner);
      pv.addEventListener('mouseenter', () => clearTimeout(closeTimer));
      pv.addEventListener('mouseleave', () => { closeTimer = setTimeout(closePreview, CLOSE_DELAY); });
      document.body.append(pv);

      // Centre on the poster, kept inside the viewport
      const h = pv.offsetHeight;
      const top = Math.min(Math.max(pr.top + pr.height / 2 - h / 2, 8), innerHeight - h - 8);
      pv.style.top = `${top}px`;
      // Start clipped to the poster's box (relative to the card), then grow to the full card
      const x = pr.left - left, y = pr.top - top;
      Object.assign(ghost.style, { left: `${x}px`, top: `${y}px`, width: `${pr.width}px`, height: `${pr.height}px` });
      const clamp = v => Math.max(0, Math.round(v));
      inner.style.setProperty('--from', `inset(${clamp(y)}px ${clamp(width - x - pr.width)}px ${clamp(h - y - pr.height)}px ${clamp(x)}px round 8px)`);
      inner.getBoundingClientRect(); // commit the start state before transitioning
      requestAnimationFrame(() => pv?.classList.add('in'));

      const key = await trailerFor(card);
      if (myReq !== req || !pv || !key) return; // moved on, or no trailer: keep the still image
      const frame = mk('iframe');
      frame.title = `${card.dataset.pvTitle} trailer`;
      frame.allow = 'autoplay; encrypted-media';
      frame.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(key)}?autoplay=1&mute=1&controls=0&loop=1&playlist=${encodeURIComponent(key)}&modestbranding=1&rel=0&playsinline=1&disablekb=1&iv_load_policy=3&enablejsapi=1`;
      frame.addEventListener('load', () => setTimeout(() => frame.classList.add('on'), 700)); // hide YouTube's loading frame
      let muted = true;
      const mute = mk('button', 'pv-mute', '🔇');
      mute.type = 'button';
      mute.setAttribute('aria-label', 'Unmute trailer');
      mute.addEventListener('click', e => {
        e.preventDefault();
        muted = !muted;
        ytCommand(frame, muted ? 'mute' : 'unMute');
        mute.textContent = muted ? '🔇' : '🔊';
        mute.setAttribute('aria-label', muted ? 'Unmute trailer' : 'Mute trailer');
      });
      media.append(frame, mute);
    }

    document.addEventListener('mouseover', e => {
      const card = e.target.closest('.card-p');
      if (!card || card === current) return;
      clearTimeout(openTimer);
      clearTimeout(closeTimer);
      if (pvImg(card)) new Image().src = pvImg(card); // warm the cache during the hover delay
      openTimer = setTimeout(() => openPreview(card), OPEN_DELAY);
    });
    document.addEventListener('mouseout', e => {
      const card = e.target.closest('.card-p');
      if (!card || card.contains(e.relatedTarget)) return;
      clearTimeout(openTimer);
      if (card === current && !pv?.contains(e.relatedTarget)) closeTimer = setTimeout(closePreview, CLOSE_DELAY);
    });
    addEventListener('scroll', () => closePreview(true), { passive: true });
    document.querySelectorAll('.track').forEach(t => t.addEventListener('scroll', () => closePreview(true), { passive: true }));
    addEventListener('keydown', e => { if (e.key === 'Escape') closePreview(); });
  }

  // Vidy player: dedicated engine for movies, series, and anime + quick season/episode navigation
  const player = document.getElementById('player');
  if (player) {
    const cfg = JSON.parse(player.dataset.cfg);
    const iframe = player.querySelector('iframe');
    const EP_KEY = `cinebase.ep.${cfg.key}`;
    const AUTONEXT_KEY = 'cinebase.autonext';
    let autoNext = localStorage.getItem(AUTONEXT_KEY) !== 'false';
    const autoNextBtn = document.getElementById('p-autonext');
    function syncAutoNext() {
      if (!autoNextBtn) return;
      autoNextBtn.textContent = `Auto-next: ${autoNext ? 'ON' : 'OFF'}`;
      autoNextBtn.classList.toggle('off', !autoNext);
    }
    syncAutoNext();
    if (autoNextBtn) {
      autoNextBtn.addEventListener('click', () => {
        autoNext = !autoNext;
        localStorage.setItem(AUTONEXT_KEY, autoNext ? 'true' : 'false');
        syncAutoNext();
      });
    }

    const state = { s: 1, e: 1 };
    let pendingNav = null; // { s, e, deadline } to guard against stale messages during episode change

    // Watch position per movie / episode (reported by Vidy events)
    const posKey = (s = state.s, e = state.e) => `cinebase.pos.${cfg.key}` + (cfg.isSeries ? `.${s}.${e}` : '');
    const resumeAt = () => {
      try {
        const key = posKey();
        const p = JSON.parse(localStorage.getItem(key) || 'null');
        if (!p || typeof p.t !== 'number' || p.t <= 30) return null;
        // If watched past 90% or within last 90 seconds, episode is completed -> restart from 0:00
        if (p.d && (p.t >= p.d - 90 || (p.d > 120 && p.t / p.d >= 0.90))) {
          localStorage.removeItem(key);
          return null;
        }
        // If duration was not recorded but time is over 35 min on a series / 18 min on anime, likely credits -> restart from 0:00
        if (!p.d && cfg.isSeries && p.t > (cfg.anime ? 1100 : 2100)) {
          localStorage.removeItem(key);
          return null;
        }
        return Math.floor(p.t);
      } catch { return null; }
    };

    // Pop-out: the player can move into an always-on-top Document Picture-in-Picture window
    // (Chrome/Edge) or, elsewhere, a plain pop-up window. While popped out the page frame is blank.
    let pipWin = null;   // the pop-out window
    let pipFrame = null; // player iframe inside a Document PiP window (null for a plain pop-up)
    const frame = () => pipFrame || iframe;

    const url = (sn = state.s, ep = state.e) => {
      const u = new URL(`https://${cfg.domain || 'www.vidy.st'}` + cfg.path
        .replace('{id}', encodeURIComponent(cfg.id)).replace('{s}', sn).replace('{e}', ep));
      const t = (sn === state.s && ep === state.e) ? resumeAt() : null;
      // Explicitly set progress=0 when starting from the beginning.
      // Vidy requires ?progress=0 in query params to override its internal localStorage history;
      // otherwise, Vidy resumes completed episodes at their end time (e.g. 40:00) and immediately skips to the next episode!
      u.searchParams.set('progress', (t && t > 0) ? t : 0);
      return u.href;
    };
    const load = (force = false) => {
      const u = url();
      if (pipWin && !pipFrame) { try { pipWin.location.href = u; } catch {} return; } // plain pop-up
      const f = frame();
      if (!f) return;
      if (force || f.src !== u) f.src = u;
    };

    // Playback events posted by Vidy player (JSON strings). Only trust our own iframe.
    let lastSaved = 0;

    function onPlayerMessage(e) {
      if (e.source !== frame().contentWindow || typeof e.data !== 'string') return;
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (!msg || typeof msg !== 'object') return;

      // Vidy sends PLAYER_EVENT during playback.
      // Do NOT process MEDIA_DATA for episode navigation — MEDIA_DATA is just a 1-second interval dump
      // of localStorage where last_episode_watched is often stale, which falsely reverts state.e to 1.
      if (msg.type !== 'PLAYER_EVENT') return;

      const data = (msg.data && typeof msg.data === 'object') ? msg.data : msg;
      const isAnime = Boolean(cfg.anime || data.type === 'anime');
      let epNum;
      let snNum;

      if (isAnime) {
        // Vidy's anime URL structure is /anime/:id/:episode (there is no season param).
        // Inside Vidy's video player (chunk 5114), param 1 (episode) is assigned to `season`, while `episode` defaults to 1.
        // Therefore, for anime events from Vidy, `data.season` is the real episode number, whereas `data.episode` is always 1!
        const parsedSeason = Number(data.season != null ? data.season : msg.season);
        const parsedEpisode = Number(data.episode != null ? data.episode : msg.episode);
        epNum = Number.isFinite(parsedSeason) && parsedSeason > 0
          ? parsedSeason
          : (Number.isFinite(parsedEpisode) && parsedEpisode > 0 ? parsedEpisode : state.e);

        const tab = cfg.seasons?.find(x => epNum >= (x.start || 1) && (!x.episodes || epNum <= (x.start || 1) + x.episodes - 1));
        snNum = tab ? tab.n : 1;
      } else {
        epNum = Number(data.episode != null ? data.episode : msg.episode);
        snNum = Number(data.season != null ? data.season : msg.season);
      }

      // 1. If we commanded a manual navigation, ignore any stale messages from old episodes until target loads
      if (pendingNav) {
        if (Date.now() < pendingNav.deadline) {
          if (Number.isFinite(epNum) && epNum === pendingNav.e && (!snNum || snNum === pendingNav.s)) {
            pendingNav = null; // Target episode arrived!
          } else {
            return; // Drop stale messages from old episode while target is loading
          }
        } else {
          pendingNav = null;
          // Deadline expired: do not let an event from an old episode revert state.e
          if (Number.isFinite(epNum) && epNum !== state.e) return;
        }
      }

      // 2. Synchronize when user navigates inside Vidy (Next Episode button, Vidy's auto-next, or drawer)
      // When Vidy auto-nexts, Next.js routes client-side without query flags.
      // We detect the episode change, clear the finished episode's progress, and reload with all flags intact (autoplay=true, nextEpisode, episodeSelector).
      if (cfg.isSeries && Number.isFinite(epNum) && epNum > 0) {
        const diffEp = epNum !== state.e;
        const diffSn = Number.isFinite(snNum) && snNum > 0 && snNum !== state.s;
        if (diffEp || diffSn) {
          // Clear previously finished episode's saved position so re-watching starts at 0:00
          try { localStorage.removeItem(posKey(state.s, state.e)); } catch {}
          play(diffSn ? snNum : state.s, epNum);
          return;
        }
      }

      const event = data.event || msg.event;
      const currentTime = Number(data.currentTime != null ? data.currentTime : msg.currentTime);
      const duration = Number(data.duration != null ? data.duration : msg.duration);

      // 3. Save watch progress periodically during playback
      if (Number.isFinite(currentTime)) {
        const isNearEnd = Number.isFinite(duration) && duration > 60 && (currentTime >= duration - 90 || currentTime / duration >= 0.90);
        const isFinished = Number.isFinite(duration) && duration > 60 && currentTime >= duration - 1;

        if (isFinished && cfg.isSeries && autoNext && !pendingNav) {
          // Episode reached the end -> clear saved position and advance cleanly to the next episode from 0:00
          try { localStorage.removeItem(posKey(snNum || state.s, epNum || state.e)); } catch {}
          lastSaved = 0;
          const nxt = step(1);
          if (nxt) {
            play(nxt.s, nxt.e);
            return;
          }
        } else if (isNearEnd) {
          // If within credits / end, clear saved position so future visits start from 0:00
          try { localStorage.removeItem(posKey(snNum || state.s, epNum || state.e)); } catch {}
          lastSaved = 0;
        } else if (Math.abs(currentTime - lastSaved) >= 5) {
          lastSaved = currentTime;
          try {
            localStorage.setItem(posKey(snNum || state.s, epNum || state.e), JSON.stringify({
              t: currentTime,
              d: Number.isFinite(duration) && duration > 0 ? duration : null
            }));
          } catch {}
        }
      }

      // 4. When episode finishes, advance to next episode if autoNext is on
      if (event === 'ended') {
        try { localStorage.removeItem(posKey(snNum || state.s, epNum || state.e)); } catch {}
        lastSaved = 0;
        if (cfg.isSeries && autoNext && !pendingNav) {
          const nxt = step(1);
          if (nxt) play(nxt.s, nxt.e);
        }
      }
    }
    addEventListener('message', onPlayerMessage);

    const popBtn = document.getElementById('p-popout');
    const popped = document.getElementById('p-popped');
    let pollClosed;

    function bringBack() {
      if (!pipWin) return;
      const w = pipWin;
      pipWin = null;
      pipFrame = null;
      clearInterval(pollClosed);
      player.classList.remove('popped');
      popped.hidden = true;
      popBtn.textContent = '⧉ Pop out';
      load(); // back in the page, resuming from the saved position
      try { if (!w.closed) w.close(); } catch {}
    }

    async function popOut() {
      if (pipWin) return bringBack();
      const u = url();
      if ('documentPictureInPicture' in window) {
        try {
          pipWin = await documentPictureInPicture.requestWindow({ width: 640, height: 360 });
        } catch { pipWin = null; }
      }
      if (pipWin) {
        const d = pipWin.document;
        d.title = document.querySelector('.d-info h1')?.childNodes[0]?.textContent.trim() || 'CineBase';
        const style = d.createElement('style');
        style.textContent = 'html,body{margin:0;height:100%;background:#000;overflow:hidden}iframe{position:fixed;inset:0;width:100%;height:100%;border:0}';
        d.head.append(style);
        pipFrame = d.createElement('iframe');
        for (const a of ['allow', 'referrerpolicy', 'allowfullscreen', 'title']) {
          if (iframe.hasAttribute(a)) pipFrame.setAttribute(a, iframe.getAttribute(a));
        }
        pipFrame.src = u;
        d.body.append(pipFrame);
        pipWin.addEventListener('message', onPlayerMessage); // the player now reports to the pop-out window
        pipWin.addEventListener('pagehide', bringBack);
      } else {
        // No Document PiP (Firefox, Safari): a normal small window — not always on top
        pipWin = window.open(u, 'cinebase-player', 'popup,width=720,height=405');
        if (!pipWin) { popBtn.textContent = 'Allow pop-ups to pop out'; return; }
        pollClosed = setInterval(() => { if (pipWin?.closed) bringBack(); }, 700);
      }
      iframe.src = 'about:blank'; // stop the page copy so audio doesn't play twice
      player.classList.add('popped');
      popped.hidden = false;
      popBtn.textContent = '⤓ Bring back';
    }

    popBtn.addEventListener('click', popOut);
    document.getElementById('p-bringback').addEventListener('click', bringBack);
    addEventListener('pagehide', () => { try { pipWin?.close(); } catch {} });

    if (cfg.isSeries) {
      const seasons = cfg.seasons;
      const tabs = [...document.querySelectorAll('.season-tab')];
      const list = document.getElementById('ep-list');
      const now = document.getElementById('ep-now');
      const prev = document.getElementById('ep-prev'), next = document.getElementById('ep-next');
      const quickPrev = document.getElementById('p-quick-prev'), quickNext = document.getElementById('p-quick-next');
      const quickSelect = document.getElementById('p-quick-select');
      const cache = {}; // season number -> episodes from TMDB / AniList (or null if unavailable)
      if (cfg.initialEpisodes && Array.isArray(cfg.initialEpisodes) && cfg.initialEpisodes.length) {
        cache[1] = cfg.initialEpisodes;
      }
      let shown = null; // season whose episodes are listed

      const sIdx = s => seasons.findIndex(x => x.n === s);
      const count = s => cache[s]?.length || seasons[sIdx(s)]?.episodes || null;
      const first = s => seasons[sIdx(s)]?.start || 1; // anime tabs start at 101, 201, …
      const last = s => (count(s) ? first(s) + count(s) - 1 : null);
      const aired = (s, e) => { const ep = cache[s]?.find(x => x.n === e); return !ep || ep.aired; };
      const fmtDate = d => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
      const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

      async function episodes(s) {
        if (s in cache) return cache[s];
        if (!cfg.epBase) return (cache[s] = null);
        try {
          const r = await fetch(`${cfg.epBase}${s}`);
          cache[s] = r.ok ? await r.json() : null;
        } catch { cache[s] = null; }
        return cache[s];
      }

      function card(s, ep) {
        const b = el('button', 'ep-card');
        b.type = 'button';
        b.dataset.e = ep.n;
        if (ep.overview) b.title = ep.overview;
        const thumb = el('span', 'ep-thumb');
        if (ep.still) {
          const img = el('img');
          img.src = ep.still;
          img.alt = '';
          img.loading = 'lazy';
          img.decoding = 'async';
          img.onerror = () => img.remove();
          thumb.append(img);
        }
        thumb.append(el('span', 'ep-badge', `E${ep.n}`), el('span', 'ep-playing', '▶ Playing'));
        const info = el('span', 'ep-info');
        const meta = ep.aired === false
          ? (ep.air_date ? `Airs ${fmtDate(ep.air_date)}` : 'Not aired yet')
          : [ep.runtime && `${ep.runtime} min`, ep.air_date && fmtDate(ep.air_date)].filter(Boolean).join(' · ');
        info.append(el('b', null, ep.name), el('small', null, meta));
        b.append(thumb, info);
        if (ep.aired === false) { b.disabled = true; b.classList.add('upcoming'); }
        else b.addEventListener('click', () => play(s, ep.n));
        return b;
      }

      // Neighbouring episode, crossing into the next/previous season when counts are known
      function step(dir) {
        const end = last(state.s);
        if (dir > 0) {
          if (!end || state.e < end) return aired(state.s, state.e + 1) ? { s: state.s, e: state.e + 1 } : null;
          const ns = seasons[sIdx(state.s) + 1];
          return ns ? { s: ns.n, e: first(ns.n) } : null;
        }
        if (state.e > first(state.s)) return { s: state.s, e: state.e - 1 };
        const ps = seasons[sIdx(state.s) - 1];
        return ps ? { s: ps.n, e: last(ps.n) || first(ps.n) } : null;
      }

      function syncQuickSelect() {
        if (!quickSelect) return;
        quickSelect.replaceChildren();
        seasons.forEach(sn => {
          const c = count(sn.n) || (cfg.anime ? Math.max(24, state.e) : 10);
          const st = first(sn.n);
          const container = seasons.length > 1 ? el('optgroup') : quickSelect;
          if (seasons.length > 1) container.label = sn.name || `Season ${sn.n}`;
          for (let e = st; e < st + c; e++) {
            const epData = cache[sn.n]?.find(x => x.n === e);
            const opt = el('option', null, cfg.anime
              ? `Ep ${e}${epData?.name && epData.name !== `Episode ${e}` ? ` · ${epData.name}` : ''}`
              : `S${sn.n} E${e}${epData?.name && epData.name !== `Episode ${e}` ? ` · ${epData.name}` : ''}`);
            opt.value = `${sn.n}:${e}`;
            container.append(opt);
          }
          if (seasons.length > 1) quickSelect.append(container);
        });
        const currentVal = `${state.s}:${state.e}`;
        quickSelect.value = currentVal;
        if (quickSelect.value !== currentVal) {
          const opt = el('option', null, cfg.anime ? `Ep ${state.e}` : `S${state.s} E${state.e}`);
          opt.value = currentVal;
          quickSelect.append(opt);
          quickSelect.value = currentVal;
        }
      }

      function mark() {
        list.querySelectorAll('.ep-card').forEach(c => {
          const on = shown === state.s && +c.dataset.e === state.e;
          c.classList.toggle('on', on);
          c.setAttribute('aria-current', on ? 'true' : 'false');
          if (on) list.scrollTo({ left: c.offsetLeft - list.offsetLeft - 8, behavior: 'smooth' }); // horizontal only
        });
        const name = cache[state.s]?.find(x => x.n === state.e)?.name;
        const label = cfg.anime ? `Episode ${state.e}` : `Season ${state.s} · Episode ${state.e}`;
        now.textContent = label + (name && name !== `Episode ${state.e}` ? ` — ${name}` : '');
        if (jump) jump.value = state.e;
        if (quickSelect) quickSelect.value = `${state.s}:${state.e}`;
        const canPrev = !!step(-1);
        const canNext = !!step(1);
        prev.disabled = !canPrev;
        next.disabled = !canNext;
        if (quickPrev) quickPrev.disabled = !canPrev;
        if (quickNext) quickNext.disabled = !canNext;
      }

      function renderCards(s, eps) {
        const items = eps?.length
          ? eps
          : Array.from({ length: count(s) || (cfg.anime ? Math.max(24, state.e) : 10) }, (_, i) => ({ n: first(s) + i, name: `Episode ${first(s) + i}` }));
        list.replaceChildren(...(items.length ? items.map(ep => card(s, ep)) : [el('p', 'ep-msg', cfg.anime ? 'Episode list unavailable — enter an episode number or use Prev / Next.' : 'Episode list unavailable — use Prev / Next.')]));
      }

      async function showSeason(s) {
        shown = s;
        tabs.forEach(t => {
          const on = +t.dataset.season === s;
          t.setAttribute('aria-selected', String(on));
          if (on) t.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        });

        // 1. Render cards instantly from cache or known counts (0ms delay)
        renderCards(s, cache[s]);
        syncQuickSelect();
        mark();

        // 2. Fetch full metadata in background (enriching titles, stills, air dates)
        const eps = await episodes(s);
        if (shown !== s) return; // switched again while loading
        if (eps?.length) {
          renderCards(s, eps);
          syncQuickSelect();
          mark();
        }
      }

      let prefetchTimer = null;
      function schedulePrefetch() {
        if (!cfg.isSeries) return;
        clearTimeout(prefetchTimer);
        prefetchTimer = setTimeout(() => {
          const nxt = step(1);
          if (!nxt) return;
          try {
            const nextHref = url(nxt.s, nxt.e);
            let link = document.getElementById('p-prefetch-next');
            if (!link) {
              link = document.createElement('link');
              link.id = 'p-prefetch-next';
              link.rel = 'prefetch';
              link.as = 'document';
              document.head.appendChild(link);
            }
            link.href = nextHref;
          } catch {}
        }, 3500);
      }

      function play(s, e) {
        s = Number(s); e = Number(e);
        if (cfg.anime) {
          const tab = seasons.find(x => e >= first(x.n) && (!last(x.n) || e <= last(x.n)));
          s = tab ? tab.n : (seasons[0]?.n || 1);
        }
        state.s = s; state.e = e;
        lastSaved = 0;
        try { localStorage.setItem(EP_KEY, JSON.stringify(state)); } catch {}
        pendingNav = { s, e, deadline: Date.now() + 15000 };
        load(true);
        if (shown !== s) showSeason(s); else mark();
        schedulePrefetch();
      }

      tabs.forEach(t => t.addEventListener('click', () => showSeason(+t.dataset.season)));
      // Anime: jump straight to any episode number (long shows / unknown counts)
      const jump = document.getElementById('ep-jump');
      jump?.addEventListener('change', () => {
        const e = Math.max(1, parseInt(jump.value, 10) || 1);
        const tab = seasons.find(x => e >= first(x.n) && (!last(x.n) || e <= last(x.n))) || seasons[seasons.length - 1];
        play(tab.n, e);
      });
      prev.addEventListener('click', () => { const t = step(-1); if (t) play(t.s, t.e); });
      next.addEventListener('click', () => { const t = step(1); if (t) play(t.s, t.e); });
      if (quickPrev) quickPrev.addEventListener('click', () => { const t = step(-1); if (t) play(t.s, t.e); });
      if (quickNext) quickNext.addEventListener('click', () => { const t = step(1); if (t) play(t.s, t.e); });
      if (quickSelect) {
        quickSelect.addEventListener('change', () => {
          const [s, e] = quickSelect.value.split(':').map(Number);
          if (s && e) play(s, e);
        });
      }

      // Resume where this viewer left off
      try {
        const saved = JSON.parse(localStorage.getItem(EP_KEY) || 'null');
        if (saved && sIdx(saved.s) >= 0 && saved.e >= 1) Object.assign(state, { s: saved.s, e: saved.e });
      } catch {}
      if (cfg.anime) {
        const tab = seasons.find(x => state.e >= first(x.n) && (!last(x.n) || state.e <= last(x.n)));
        state.s = tab ? tab.n : (seasons[0]?.n || 1);
      } else {
        if (sIdx(state.s) < 0 && seasons.length) state.s = seasons[0].n;
        if (state.e < first(state.s)) state.e = first(state.s);
      }
      if (state.s !== 1 || state.e !== 1) {
        pendingNav = { s: state.s, e: state.e, deadline: Date.now() + 15000 };
      }
      showSeason(state.s);
      schedulePrefetch();
    }

    load();
  }})();
