/* global ZOHO */
(function () {
  "use strict";

  var FIVE_MIN_MS = 5 * 60 * 1000;
  var TIME_FMT   = { hour: "2-digit", minute: "2-digit" };
  var DATE_FMT   = { year: "numeric", month: "long", day: "numeric" };

  // ─── Detect if running inside Zoho CRM iframe ───
  function isInsideZohoCRM() {
    try {
      return window.self !== window.top;
    } catch (e) {
      return true; // cross-origin = inside iframe
    }
  }

  // ─── Entry Point ───
  if (isInsideZohoCRM()) {
    console.log("Running inside Zoho CRM iframe");
    initWithSDK();
  } else {
    console.log("Running standalone (not in CRM iframe)");
    fallbackUI();
  }

  function initWithSDK() {
    var sdkReady = false;
    var retries = 0;
    var maxRetries = 50; // 50 x 200ms = 10s max wait

    function checkSDK() {
      if (typeof ZOHO !== "undefined" && ZOHO.embeddedApp) {
        if (!sdkReady) {
          sdkReady = true;
          registerAndInit();
        }
      } else if (retries < maxRetries) {
        retries++;
        setTimeout(checkSDK, 200);
      } else {
        console.error("Zoho SDK failed to load after " + maxRetries + " attempts");
        fallbackUI();
      }
    }

    checkSDK();
  }

  function registerAndInit() {
    console.log("SDK detected — calling init()...");

    // IMPORTANT: Call init() FIRST, then use APIs after it resolves
    // Do NOT register PageLoad for widget-panel placements — it often doesn't fire
    ZOHO.embeddedApp.init()
      .then(function () {
        console.log("✅ SDK init() resolved successfully");
        buildWidget();
      })
      .catch(function (err) {
        console.error("SDK init() failed:", err);
        // Still try to build — sometimes init rejects but APIs work
        buildWidget();
      });

    // Safety net: if init() hangs forever, force build after 5s
    setTimeout(function () {
      if (!hasBuilt) {
        console.warn("init() timed out — forcing buildWidget()");
        buildWidget();
      }
    }, 5000);
  }

  // ─── Main widget flow ───
  var hasBuilt = false;

  function buildWidget() {
    if (hasBuilt) return;
    hasBuilt = true;
    console.log("buildWidget() started");

    // Show greeting immediately — don't wait for API
    document.getElementById("greeting").textContent = "Hi there! 👋";
    startClock();

    // Try to get user info (non-blocking)
    fetchUserAndMeetings();
  }

  async function fetchUserAndMeetings() {
    var userName = "there";
    var userId = null;

    // Step 1: Get current user
    try {
      console.log("Calling getCurrentUser...");
      var userResp = await ZOHO.CRM.CONFIG.getCurrentUser();
      console.log("getCurrentUser response:", JSON.stringify(userResp));

      var users = userResp.users || userResp.Users || [];
      if (users.length) {
        var user = users[0];
        userName = user.first_name || user.full_name || user.email || "there";
        userId = user.id;
        console.log("✅ Got user:", userName, "ID:", userId);
      }
    } catch (userErr) {
      console.error("getCurrentUser failed:", userErr);
      console.log("This usually means the widget doesn't have ZohoCRM.users.READ scope");
    }

    // Update greeting with actual name
    document.getElementById("greeting").textContent = "Hi " + userName + "! 👋";

    // Transition to meetings page after 2.5s
    setTimeout(showMeetingsPage, 2500);

    // Step 2: Fetch meetings
    if (userId) {
      try {
        var todayMeetings = await fetchTodaysMeetings(userId);
        renderMeetings(todayMeetings);
        requestNotificationPermission();
        scheduleNotifications(todayMeetings);
      } catch (meetErr) {
        console.error("Meeting fetch failed:", meetErr);
        renderMeetings([]);
      }
    } else {
      console.log("No userId — trying to fetch meetings without user filter");
      try {
        var meetings = await fetchAllTodaysMeetings();
        renderMeetings(meetings);
        requestNotificationPermission();
        scheduleNotifications(meetings);
      } catch (e) {
        console.error("Fallback meeting fetch failed:", e);
        renderMeetings([]);
      }
    }
  }

  function fallbackUI() {
    console.log("fallbackUI() — showing default state");
    document.getElementById("greeting").textContent = "Hi there! 👋";
    startClock();
    setTimeout(showMeetingsPage, 2500);
    renderMeetings([]);
  }

  // ─── Page transition ───
  function showMeetingsPage() {
    var greetPage = document.getElementById("page-greeting");
    var meetPage  = document.getElementById("page-meetings");

    if (!greetPage || !meetPage) return;

    greetPage.classList.add("fadeOut");

    setTimeout(function () {
      greetPage.style.display = "none";
      meetPage.classList.remove("hidden");
      meetPage.classList.add("fadeIn");
    }, 800);
  }

  // ─── Fetch today's meetings (with user filter) ───
  async function fetchTodaysMeetings(userId) {
    var todayStr = getTodayString();
    console.log("Fetching events for:", todayStr, "userId:", userId);

    // Method 1: searchRecord with criteria
    try {
      var criteria = "((Start_DateTime:starts_with:" + todayStr + ")and(Owner:equals:" + userId + "))";
      console.log("Search criteria:", criteria);

      var response = await ZOHO.CRM.API.searchRecord({
        Entity: "Events",
        Type: "criteria",
        Query: criteria,
        page: 1,
        per_page: 200
      });

      console.log("searchRecord response:", JSON.stringify(response));

      if (response && response.data && response.data.length) {
        return response.data;
      }
    } catch (searchErr) {
      console.warn("searchRecord failed:", searchErr);
    }

    // Method 2: getRecords fallback with client-side filter
    return await fetchAllTodaysMeetings();
  }

  // ─── Fetch today's meetings (no user filter) ───
  async function fetchAllTodaysMeetings() {
    var todayStr = getTodayString();
    console.log("Fetching all events, filtering for:", todayStr);

    try {
      var allEvents = await ZOHO.CRM.API.getRecords({
        Entity: "Events",
        sort_order: "asc",
        sort_by: "Start_DateTime",
        per_page: 200,
        page: 1
      });

      console.log("getRecords response:", JSON.stringify(allEvents));

      if (allEvents && allEvents.data) {
        return allEvents.data.filter(function (evt) {
          var startDate = (evt.Start_DateTime || "").slice(0, 10);
          return startDate === todayStr;
        });
      }
    } catch (getErr) {
      console.warn("getRecords failed:", getErr);
    }

    return [];
  }

  // ─── Render meetings ───
  function renderMeetings(meetings) {
    var ul = document.getElementById("meetings");
    if (!ul) return;
    ul.innerHTML = "";

    if (!meetings || !meetings.length) {
      ul.innerHTML = '<li class="no-meetings">No meetings scheduled for today 🎉</li>';
      return;
    }

    meetings.sort(function (a, b) {
      return new Date(a.Start_DateTime) - new Date(b.Start_DateTime);
    });

    meetings.forEach(function (meet, index) {
      var li = document.createElement("li");
      li.style.animationDelay = (index * 0.15) + "s";
      li.className = "meeting-item";

      var when    = formatTime(meet.Start_DateTime);
      var endTime = meet.End_DateTime ? " - " + formatTime(meet.End_DateTime) : "";
      var subject = sanitize(meet.Event_Title || meet.Subject || "Untitled Meeting");

      li.innerHTML =
        '<div class="meeting-time">🕐 ' + when + endTime + "</div>" +
        '<div class="meeting-subject">' + subject + "</div>";

      ul.appendChild(li);
    });
  }

  // ─── Notifications ───
  function requestNotificationPermission() {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }

  function scheduleNotifications(meetings) {
    if (!("Notification" in window)) return;
    var now = Date.now();
    meetings.forEach(function (meet) {
      var startTs   = new Date(meet.Start_DateTime).getTime();
      var triggerIn = startTs - FIVE_MIN_MS - now;
      if (triggerIn > 0) {
        setTimeout(function () { fireNotification(meet); }, triggerIn);
      }
    });
  }

  function fireNotification(meet) {
    if (Notification.permission !== "granted") return;

    var anim = document.getElementById("notifyAnim");
    if (anim) {
      anim.style.display = "block";
      setTimeout(function () { anim.style.display = "none"; }, 4000);
    }

    new Notification("⏰ Meeting in 5 minutes!", {
      body: meet.Event_Title || meet.Subject || "Upcoming meeting",
      icon: "https://cdn-icons-png.flaticon.com/512/726/726448.png"
    });
  }

  // ─── Clock ───
  function startClock() {
    var clk = document.getElementById("clock");
    if (!clk) return;
    function tick() {
      var now = new Date();
      clk.textContent =
        now.toLocaleDateString(undefined, DATE_FMT) + "  •  " +
        now.toLocaleTimeString(undefined, TIME_FMT);
    }
    tick();
    setInterval(tick, 1000);
  }

  // ─── Utilities ───
  function getTodayString() {
    var now  = new Date();
    var yyyy = now.getFullYear();
    var mm   = String(now.getMonth() + 1).padStart(2, "0");
    var dd   = String(now.getDate()).padStart(2, "0");
    return yyyy + "-" + mm + "-" + dd;
  }

  function formatTime(iso) {
    if (!iso) return "";
    return new Date(iso).toLocaleTimeString(undefined, TIME_FMT);
  }

  function sanitize(str) {
    var div = document.createElement("div");
    div.textContent = str || "";
    return div.innerHTML;
  }
})();