/**
 * SSE client — vanilla EventSource with reconnection + missed-message catch-up.
 * Replaces htmx-ext-sse for full control over connection lifecycle.
 */

(function () {
  'use strict';

  var config = null;   // { streamUrl, catchUpUrl, conversationId }
  var es = null;        // EventSource instance
  var statusDot = null; // DOM element for connection indicator
  var container = null; // #messages-container
  var scrollBtn = null; // scroll-to-bottom button
  var scrollBtnCount = null; // badge inside button
  var retryDelay = 1000;
  var maxRetryDelay = 16000;
  var lastMessageTs = null; // ISO timestamp of most recent message
  var reconnectTimer = null;
  var newMsgCount = 0;       // unread messages while scrolled up
  var NEAR_BOTTOM_PX = 100;  // threshold for "at bottom"

  function isNearBottom() {
    if (!container) return true;
    return container.scrollHeight - container.scrollTop - container.clientHeight < NEAR_BOTTOM_PX;
  }

  function updateScrollBtn() {
    if (!scrollBtn) return;
    if (isNearBottom()) {
      scrollBtn.classList.add('hidden');
      newMsgCount = 0;
    } else {
      scrollBtn.classList.remove('hidden');
    }
    if (scrollBtnCount) {
      if (newMsgCount > 0) {
        scrollBtnCount.textContent = newMsgCount + ' new';
        scrollBtnCount.classList.remove('hidden');
      } else {
        scrollBtnCount.classList.add('hidden');
      }
    }
  }

  // --- Public helpers ---
  window.scrollChatToBottom = function (smooth) {
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    newMsgCount = 0;
    updateScrollBtn();
  };

  // --- Public init ---
  window.initSSE = function (opts) {
    config = opts;
    container = document.getElementById('messages-container');
    statusDot = document.getElementById('sse-status-dot');
    scrollBtn = document.getElementById('scroll-to-bottom');
    scrollBtnCount = scrollBtn ? scrollBtn.querySelector('.scroll-btn-count') : null;
    lastMessageTs = opts.lastMessageTs || null;

    // Track scroll position
    if (container) {
      container.addEventListener('scroll', updateScrollBtn);
    }
    if (scrollBtn) {
      scrollBtn.addEventListener('click', function () { window.scrollChatToBottom(true); });
    }

    connect();
  };

  // --- Connection ---
  function connect() {
    if (es) {
      es.onopen = null;
      es.onerror = null;
      es.onmessage = null;
      es.close();
    }
    setStatus('connecting');

    es = new EventSource(config.streamUrl);

    es.onopen = function () {
      retryDelay = 1000; // reset backoff
      setStatus('connected');
    };

    es.addEventListener('message', function (e) {
      appendHTML(e.data);
    });

    es.onerror = function () {
      // EventSource auto-closes on error
      if (es) es.close();
      es = null;
      setStatus('disconnected');
      scheduleReconnect();
    };
  }

  function scheduleReconnect() {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    setStatus('reconnecting');
    reconnectTimer = setTimeout(function () {
      reconnectTimer = null;
      catchUpAndReconnect();
    }, retryDelay);
    // Exponential backoff
    retryDelay = Math.min(retryDelay * 2, maxRetryDelay);
  }

  function catchUpAndReconnect() {
    if (!lastMessageTs) {
      // No messages yet — just reconnect
      connect();
      return;
    }

    var url = config.catchUpUrl + '?since=' + encodeURIComponent(lastMessageTs);
    fetch(url, { credentials: 'same-origin' })
      .then(function (resp) {
        if (!resp.ok) throw new Error('catch-up failed: ' + resp.status);
        return resp.json();
      })
      .then(function (data) {
        if (data.messages && data.messages.length > 0) {
          for (var i = 0; i < data.messages.length; i++) {
            appendHTML(data.messages[i].html);
            if (data.messages[i].createdAt) {
              lastMessageTs = data.messages[i].createdAt;
            }
          }
        }
        connect();
      })
      .catch(function () {
        // catch-up failed — still try to reconnect
        connect();
      });
  }

  // --- DOM helpers ---
  function appendHTML(html) {
    if (!container) return;
    var wasNearBottom = isNearBottom();
    var temp = document.createElement('div');
    temp.innerHTML = html;

    // Extract data-created-at from the appended message for timestamp tracking
    var msgEl = temp.querySelector('[data-created-at]');
    if (msgEl) {
      lastMessageTs = msgEl.getAttribute('data-created-at');
    }

    while (temp.firstChild) {
      container.appendChild(temp.firstChild);
    }

    if (wasNearBottom) {
      container.scrollTop = container.scrollHeight;
    } else {
      newMsgCount++;
      updateScrollBtn();
    }
  }

  function setStatus(state) {
    if (!statusDot) return;
    statusDot.className = 'sse-dot sse-' + state;
    statusDot.title =
      state === 'connected' ? 'Live — connected' :
      state === 'reconnecting' ? 'Reconnecting…' :
      state === 'connecting' ? 'Connecting…' :
      'Disconnected';
  }
})();
