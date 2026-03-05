/* global ZOHO */
(function () {
  var FIVE_MIN_MS = 5 * 60 * 1000;
  var TIME_FMT = { hour: '2-digit', minute: '2-digit' };
  var DATE_FMT = { year: 'numeric', month: 'long', day: 'numeric' };

  // ─── 1. Register PageLoad handler, THEN init ───
  ZOHO.embeddedApp.on('PageLoad', function (data) {
    console.log('PageLoad fired', data);
    buildWidget();
  });

  ZOHO.embeddedApp.init().then(function () {
    console.log('SDK initialized');
  });

  // ─── 2. Main widget flow ───
  async function buildWidget() {
    try {
      // Fetch logged-in user via CONFIG (correct API)
      var userResp = await ZOHO.CRM.CONFIG.getCurrentUser();
      console.log('getCurrentUser response:', JSON.stringify(userResp));

      var users = userResp.users || userResp.Users || [];
      if (!users.length) {
        document.getElementById('greeting').textContent = 'Hi there!';
        console.warn('No user data returned');
      } else {
        var user = users[0];
        var name = user.first_name || user.full_name || user.email || 'there';
        document.getElementById('greeting').textContent = 'Hi ' + name + '! 👋';
      }

      // Start clock
      startClock();

      // Transition to meetings page after 2.5 seconds
      setTimeout(function () {
        showMeetingsPage();
      }, 2500);

      // Fetch and render meetings
      var userId = users.length ? users[0].id : null;
      if (userId) {
        var todayMeetings = await fetchTodaysMeetings(userId);
        renderMeetings(todayMeetings);
        requestNotificationPermission();
        scheduleNotifications(todayMeetings);
      } else {
        renderMeetings([]);
      }
    } catch (err) {
      console.error('buildWidget error:', err);
      document.getElementById('greeting').textContent = 'Hi there!';
      startClock();
      setTimeout(showMeetingsPage, 2500);
      renderMeetings([]);
    }
  }

  // ─── 3. Page transition (greeting → meetings) ───
  function showMeetingsPage() {
    var greetPage = document.getElementById('page-greeting');
    var meetPage = document.getElementById('page-meetings');

    // Fade out greeting
    greetPage.classList.add('fadeOut');

    setTimeout(function () {
      greetPage.style.display = 'none';
      meetPage.classList.remove('hidden');
      meetPage.classList.add('fadeIn');
    }, 800);
  }

  // ─── 4. Fetch today's meetings ───
  async function fetchTodaysMeetings(userId) {
    try {
      var now = new Date();
      var yyyy = now.getFullYear();
      var mm = String(now.getMonth() + 1).padStart(2, '0');
      var dd = String(now.getDate()).padStart(2, '0');
      var todayStr = yyyy + '-' + mm + '-' + dd;

      // Try search first
      var criteria = '((Start_DateTime:starts_with:' + todayStr + ')and(Owner:equals:' + userId + '))';
      console.log('Search criteria:', criteria);

      var response = await ZOHO.CRM.API.searchRecord({
        Entity: 'Events',
        Type: 'criteria',
        Query: criteria,
        page: 1,
        per_page: 200
      });

      console.log('searchRecord response:', JSON.stringify(response));

      if (response && response.data) {
        return response.data;
      }

      // Fallback: get all events and filter client-side
      console.log('Search returned no data, trying getRecords...');
      var allEvents = await ZOHO.CRM.API.getRecords({
        Entity: 'Events',
        sort_order: 'asc',
        sort_by: 'Start_DateTime',
        per_page: 200,
        page: 1
      });

      if (allEvents && allEvents.data) {
        return allEvents.data.filter(function (evt) {
          var startDate = (evt.Start_DateTime || '').slice(0, 10);
          return startDate === todayStr;
        });
      }

      return [];
    } catch (err) {
      console.error('fetchTodaysMeetings error:', err);
      return [];
    }
  }

  // ─── 5. Render meetings ───
  function renderMeetings(meetings) {
    var ul = document.getElementById('meetings');
    ul.innerHTML = '';

    if (!meetings || !meetings.length) {
      ul.innerHTML = '<li class="no-meetings">No meetings scheduled for today 🎉</li>';
      return;
    }

    meetings.sort(function (a, b) {
      return new Date(a.Start_DateTime) - new Date(b.Start_DateTime);
    });

    meetings.forEach(function (meet, index) {
      var li = document.createElement('li');
      li.style.animationDelay = (index * 0.15) + 's';
      li.className = 'meeting-item';

      var when = formatTime(meet.Start_DateTime);
      var endTime = meet.End_DateTime ? ' - ' + formatTime(meet.End_DateTime) : '';
      var subject = sanitize(meet.Event_Title || meet.Subject || 'Untitled Meeting');

      li.innerHTML =
        '<div class="meeting-time">🕐 ' + when + endTime + '</div>' +
        '<div class="meeting-subject">' + subject + '</div>';

      ul.appendChild(li);
    });
  }

  // ─── 6. Notifications ───
  function requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }

  function scheduleNotifications(meetings) {
    if (!('Notification' in window)) return;
    var now = Date.now();
    meetings.forEach(function (meet) {
      var startTs = new Date(meet.Start_DateTime).getTime();
      var triggerIn = startTs - FIVE_MIN_MS - now;
      if (triggerIn > 0) {
        setTimeout(function () { fireNotification(meet); }, triggerIn);
      }
    });
  }

  function fireNotification(meet) {
    if (Notification.permission !== 'granted') return;

    var anim = document.getElementById('notifyAnim');
    if (anim) {
      anim.style.display = 'block';
      setTimeout(function () { anim.style.display = 'none'; }, 4000);
    }

    new Notification('⏰ Meeting in 5 minutes!', {
      body: meet.Event_Title || meet.Subject || 'Upcoming meeting',
      icon: 'https://cdn-icons-png.flaticon.com/512/726/726448.png'
    });
  }

  // ─── 7. Clock ───
  function startClock() {
    var clk = document.getElementById('clock');
    function tick() {
      var now = new Date();
      clk.textContent =
        now.toLocaleDateString(undefined, DATE_FMT) + '  •  ' +
        now.toLocaleTimeString(undefined, TIME_FMT);
    }
    tick();
    setInterval(tick, 1000);
  }

  // ─── 8. Utilities ───
  function formatTime(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleTimeString(undefined, TIME_FMT);
  }

  function sanitize(str) {
    var div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }
})();