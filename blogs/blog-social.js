/* ===========================================================================
   blog-social.js — shared LIKE / SHARE / COMMENT logic for blog posts.
   Loaded as: <script src="blog-social.js"></script>  (plain script, no module)

   Zero-setup backend — NOTHING for the site owner to configure:
     • Comments + likes are stored in a free public JSON object on
       restful-api.dev (one object per post, CORS-open, browser read/write).
     • Each post maps to a stable object id in STORE_IDS below.
   Data shape stored per post:  { likes: <int>, comments: [ {id,name,text,ts,likes} ] }
   Likes/comment-likes toggles are remembered per-visitor in localStorage.
   =========================================================================== */

var API = "https://api.restful-api.dev/objects";

// Stable object id per post (pre-created). If a post isn't listed, one is
// created on first load and remembered in localStorage as a fallback.
var STORE_IDS = {
    "beyond-the-singularity": "ff8081819d82fab6019f40f540602fd1",
    "flow-vla-architecture": "ff8081819d82fab6019f40f5418b2fd2",
    "fokker-planck-equation": "ff8081819d82fab6019f40f542b82fd3",
    "a-rough-road-towards-robot-intelligence": "ff8081819d82fab6019f40f543bb2fd4"
};

var postId = (function () {
    var file = location.pathname.split("/").pop() || "index";
    return file.replace(/\.html?$/i, "") || "index";
})();

var LS_LIKE_KEY = "blogLiked:" + postId;
var LS_CLIKE_PREFIX = "blogCLiked:" + postId + ":";
var LS_STOREID = "blogStoreId:" + postId;

var storeId = STORE_IDS[postId] || localStorage.getItem(LS_STOREID) || null;
var state = { likes: 0, comments: [] };   // local mirror of the remote object
var polling = false;

// ---------------------------------------------------------------------------
// icons
// ---------------------------------------------------------------------------
var ICON = {
    heart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6.7-4.35-9.3-8.05C.9 10.2 1.4 6.9 4.1 5.6c2-1 4.2-.3 5.4 1.3L12 9l2.5-2.1c1.2-1.6 3.4-2.3 5.4-1.3 2.7 1.3 3.2 4.6 1.4 7.35C18.7 16.65 12 21 12 21z"/></svg>',
    share: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/></svg>',
    comment: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
    trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14"/></svg>',
    heartSmall: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6.7-4.35-9.3-8.05C.9 10.2 1.4 6.9 4.1 5.6c2-1 4.2-.3 5.4 1.3L12 9l2.5-2.1c1.2-1.6 3.4-2.3 5.4-1.3 2.7 1.3 3.2 4.6 1.4 7.35C18.7 16.65 12 21 12 21z"/></svg>'
};

function esc(s) {
    return String(s == null ? "" : s)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function relTime(ms) {
    if (!ms) return "just now";
    var diff = (Date.now() - ms) / 1000;
    if (diff < 60) return "just now";
    if (diff < 3600) return Math.floor(diff / 60) + "m ago";
    if (diff < 86400) return Math.floor(diff / 3600) + "h ago";
    if (diff < 604800) return Math.floor(diff / 86400) + "d ago";
    return new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
var toastTimer = null;
function showToast(msg) {
    var t = document.querySelector(".bs-toast");
    if (!t) { t = document.createElement("div"); t.className = "bs-toast"; document.body.appendChild(t); }
    t.textContent = msg;
    void t.offsetWidth;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("show"); }, 2000);
}

// ---------------------------------------------------------------------------
// remote store: read / write the per-post JSON object
// ---------------------------------------------------------------------------
function ensureStore() {
    // returns a Promise resolving to the object id (creating one if needed)
    if (storeId) return Promise.resolve(storeId);
    return fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "thz-blog:" + postId, data: { likes: 0, comments: [] } })
    }).then(function (r) { return r.json(); }).then(function (j) {
        storeId = j.id;
        try { localStorage.setItem(LS_STOREID, storeId); } catch (e) {}
        return storeId;
    });
}
function loadState() {
    if (!storeId) return Promise.resolve(state);
    return fetch(API + "/" + storeId, { headers: { "Accept": "application/json" } })
        .then(function (r) { return r.json(); })
        .then(function (j) {
            var d = (j && j.data) || {};
            state.likes = typeof d.likes === "number" ? d.likes : 0;
            state.comments = Array.isArray(d.comments) ? d.comments : [];
            return state;
        }).catch(function () { return state; });
}
function saveState() {
    return ensureStore().then(function (id) {
        return fetch(API + "/" + id, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: "thz-blog:" + postId, data: { likes: state.likes, comments: state.comments } })
        });
    });
}

// ===========================================================================
// interaction bar
// ===========================================================================
function buildBar() {
    var bar = document.getElementById("blog-interaction-bar");
    if (!bar) return;
    bar.classList.add("blog-interaction-bar");
    var liked = localStorage.getItem(LS_LIKE_KEY) === "1";
    bar.innerHTML =
        '<button type="button" class="bs-btn bs-like-btn' + (liked ? " liked" : "") +
            '" aria-pressed="' + (liked ? "true" : "false") + '" aria-label="Like this post">' +
            ICON.heart + '<span class="bs-count" id="bs-like-count">' + state.likes + '</span></button>' +
        '<button type="button" class="bs-btn bs-share-btn" aria-label="Copy link to this post">' +
            ICON.share + '<span>Share</span></button>' +
        '<button type="button" class="bs-btn bs-comment-btn" aria-label="Jump to comments">' +
            ICON.comment + '<span>Leave comment</span></button>';

    var likeBtn = bar.querySelector(".bs-like-btn");
    var countEl = bar.querySelector("#bs-like-count");

    likeBtn.addEventListener("click", function () { onLikePost(likeBtn, countEl); });

    bar.querySelector(".bs-share-btn").addEventListener("click", function () {
        var url = location.href;
        function done() { showToast("Link Copied to Clipboard"); }
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(url).then(done, fallback);
        } else { fallback(); }
        function fallback() {
            var ta = document.createElement("textarea");
            ta.value = url; ta.style.position = "fixed"; ta.style.opacity = "0";
            document.body.appendChild(ta); ta.select();
            try { document.execCommand("copy"); } catch (e) {}
            document.body.removeChild(ta); done();
        }
    });

    bar.querySelector(".bs-comment-btn").addEventListener("click", function () {
        var sec = document.getElementById("blog-comments");
        if (sec) sec.scrollIntoView({ behavior: "smooth", block: "start" });
        var ta = document.getElementById("bs-comment-text");
        if (ta) setTimeout(function () { ta.focus(); }, 500);
    });
}

function onLikePost(btn, countEl) {
    var wasLiked = localStorage.getItem(LS_LIKE_KEY) === "1";
    var nowLiked = !wasLiked;
    localStorage.setItem(LS_LIKE_KEY, nowLiked ? "1" : "0");
    btn.classList.toggle("liked", nowLiked);
    btn.setAttribute("aria-pressed", nowLiked ? "true" : "false");
    // refresh from remote, apply delta, save (keeps count roughly consistent)
    loadState().then(function () {
        state.likes = Math.max(0, state.likes + (nowLiked ? 1 : -1));
        countEl.textContent = state.likes;
        return saveState();
    }).catch(function () {});
}

// ===========================================================================
// comments
// ===========================================================================
function buildComments() {
    var sec = document.getElementById("blog-comments");
    if (!sec) return;
    sec.classList.add("blog-comments");
    sec.innerHTML =
        '<h2>Comments</h2>' +
        '<form class="bs-comment-form" id="bs-comment-form">' +
            '<input type="text" id="bs-comment-name" placeholder="Name (optional)" autocomplete="name" maxlength="80">' +
            '<textarea id="bs-comment-text" placeholder="Leave a comment..." required maxlength="4000"></textarea>' +
            '<button type="submit" id="bs-comment-submit">Post comment</button>' +
        '</form>' +
        '<ul class="bs-comment-list" id="bs-comment-list">' +
            '<li class="bs-empty">No comments yet. Be the first to comment!</li>' +
        '</ul>';
    sec.querySelector("#bs-comment-form").addEventListener("submit", onPostComment);
    renderComments();
}

function renderComments() {
    var list = document.getElementById("bs-comment-list");
    if (!list) return;
    var arr = (state.comments || []).slice().sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
    if (!arr.length) {
        list.innerHTML = '<li class="bs-empty">No comments yet. Be the first to comment!</li>';
        return;
    }
    list.innerHTML = arr.map(function (c) {
        var cliked = localStorage.getItem(LS_CLIKE_PREFIX + c.id) === "1";
        return '<li class="bs-comment" data-id="' + esc(c.id) + '">' +
            '<div class="bs-comment-head">' +
                '<span class="bs-comment-author">' + esc(c.name || "Anonymous") + '</span>' +
                '<span class="bs-comment-time">' + esc(relTime(c.ts)) + '</span>' +
            '</div>' +
            '<div class="bs-comment-text">' + esc(c.text) + '</div>' +
            '<div class="bs-comment-actions">' +
                '<button type="button" class="bs-clike' + (cliked ? " liked" : "") + '" data-id="' + esc(c.id) +
                    '" aria-label="Like comment">' + ICON.heartSmall +
                    '<span class="bs-clike-count">' + (c.likes || 0) + '</span></button>' +
                '<button type="button" class="bs-cdelete" data-id="' + esc(c.id) +
                    '" aria-label="Delete comment">' + ICON.trash + '<span>Delete</span></button>' +
            '</div></li>';
    }).join("");
    list.querySelectorAll(".bs-clike").forEach(function (b) {
        b.addEventListener("click", function () { onLikeComment(b.dataset.id); });
    });
    list.querySelectorAll(".bs-cdelete").forEach(function (b) {
        b.addEventListener("click", function () { onDeleteComment(b.dataset.id); });
    });
}

function onPostComment(e) {
    e.preventDefault();
    var nameEl = document.getElementById("bs-comment-name");
    var textEl = document.getElementById("bs-comment-text");
    var submit = document.getElementById("bs-comment-submit");
    var text = (textEl.value || "").trim();
    if (!text) return;
    var name = (nameEl.value || "").trim() || "Anonymous";
    submit.disabled = true;
    loadState().then(function () {
        state.comments.push({
            id: "c" + Date.now() + Math.floor(Math.random() * 1e4).toString(36),
            name: name, text: text, ts: Date.now(), likes: 0
        });
        return saveState();
    }).then(function () {
        textEl.value = "";
        renderComments();
    }).catch(function () { showToast("Could not post comment."); })
      .then(function () { submit.disabled = false; });
}

function onLikeComment(id) {
    var key = LS_CLIKE_PREFIX + id;
    var nowLiked = localStorage.getItem(key) !== "1";
    localStorage.setItem(key, nowLiked ? "1" : "0");
    loadState().then(function () {
        var c = state.comments.filter(function (x) { return x.id === id; })[0];
        if (c) { c.likes = Math.max(0, (c.likes || 0) + (nowLiked ? 1 : -1)); }
        renderComments();
        return saveState();
    }).catch(function () {});
}

function onDeleteComment(id) {
    if (!confirm("Delete this comment?")) return;
    loadState().then(function () {
        state.comments = state.comments.filter(function (x) { return x.id !== id; });
        renderComments();
        return saveState();
    }).catch(function () { showToast("Could not delete comment."); });
}

// ===========================================================================
// boot
// ===========================================================================
function boot() {
    buildBar();
    buildComments();
    // pull live data, then refresh UI
    loadState().then(function () {
        var countEl = document.getElementById("bs-like-count");
        if (countEl) countEl.textContent = state.likes;
        renderComments();
    }).catch(function () {});
}
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
} else { boot(); }
