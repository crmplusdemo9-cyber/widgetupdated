/* global ZOHO */
(function () {
  "use strict";

  var FIVE_MIN_MS = 5 * 60 * 1000;
  var TIME_FMT   = { hour: "2-digit", minute: "2-digit" };
  var DATE_FMT   = { year: "numeric", month: "long", day: "numeric" };

  // ─── Safety: wait for SDK script to fully load ───
  function waitForSDK(callback, retries) {
    retries = retries || 0;
    if (typeof ZOHO !== "undefined" && ZOHO.embeddedApp) {
      callback();
    } else if (retries < 30) {
      console.log("Waiting for Zoho SDK... attempt " + (retries + 1));
      setTimeout(function () { waitForSDK(callback, retries + 1); }, 300);
    } else {
      console.error("Zoho SDK never loaded after 30 attempts!");
      fallbackUI();
    }
  }

  waitForSDK(function () {
    console.log("Zoho SDK found, registering PageLoad...");

    // Register PageLoad BEFORE init
    ZOHO.embeddedApp.on("PageLoad", function (data) {
      console.log("PageLoad fired", data);
      buildWidget();
    });

    ZOHO.embeddedApp.init().then(function () {
      console.log("SDK init() resolved");

      // ─── CRITICAL FALLBACK ───
      // PageLoad event does NOT fire for all widget placements.
      // If still showing "Loading..." after 3s, run buildWidget anyway.
      setTimeout(function () {
        var greeting = document.getElementById("greeting");
        if (greeting && greeting.textContent === "Loading...") {
          console.warn("PageLoad never fired — running buildWidget as fallback");
          buildWidget();
        }
      }, 3000);
    }).catch(function (err) {
      console.error("SDK init error:", err);
      fallbackUI();
    });
  });

  // ─── 2. Main widget flow ───
  var hasBuilt = false;
  async function buildWidget() {
    if (hasBuilt) return;
    hasBuilt = true;
    console.log("buildWidget() started");

    try {
      var userName = "there";
      var userId   = null;

      try {
        var userResp = await ZOHO.CRM.CONFIG.getCurrentUser();
        console.log("getCurrentUser response:", JSON.stringify(userResp));

        var users = userResp.users || userResp.Users || [];
        if (users.length) {
          var user = users[0];
          userName = user.first_name || user.full_name || user.email || "there";
          userId   = user.id;
        }
      } catch (userErr) {
        console.error("getCurrentUser failed:", userErr);
      }

      document.getElementById("greeting").textContent = "Hi " + userName + "! 👋";
      startClock();

      // Transition to meetings after 2.5s
      setTimeout(showMeetingsPage, 2500);

      // Fetch & render meetings
      if (userId) {
        var todayMeetings = await fetchTodaysMeetings(userId);
        renderMeetings(todayMeetings);
        requestNotificationPermission();
        scheduleNotifications(todayMeetings);
      } else {
        renderMeetings([]);
      }
    } catch (err) {
      console.error("buildWidget error:", err);
      fallbackUI();
    }
  }

  function fallbackUI() {
    document.getElementById("greeting").textContent = "Hi there! 👋";
    startClock();
    setTimeout(showMeetingsPage, 2500);
    renderMeetings([]);
  }

  // ─── 3. Page transition ───
  function showMeetingsPage() {
    var greetPage = document.getElementById("page-greeting");
    var meetPage  = document.getElementById("page-meetings");

    greetPage.classList.add("fadeOut");

    setTimeout(function () {
      greetPage.style.display = "none";
      meetPage.classList.remove("hidden");
      meetPage.classList.add("fadeIn");
    }, 800);
  }

  // ─── 4. Fetch today's meetings ───
  async function fetchTodaysMeetings(userId) {
    try {
      var now      = new Date();
      var yyyy     = now.getFullYear();
      var mm       = String(now.getMonth() + 1).padStart(2, "0");
      var dd       = String(now.getDate()).padStart(2, "0");
      var todayStr = yyyy + "-" + mm + "-" + dd;

      console.log("Fetching events for:", todayStr, "userId:", userId);

      // Method 1: searchRecord
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

      // Method 2: getRecords fallback
      console.log("Trying getRecords fallback...");
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
    } catch (err) {
      console.error("fetchTodaysMeetings error:", err);
      return [];
    }
  }

  // ─── 5. Render meetings ───
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

  // ─── 6. Notifications ───
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

  // ─── 7. Clock ───
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

  // ─── 8. Utilities ───
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