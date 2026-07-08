/* ===========================================================================
   blog-social.js — shared LIKE / REPOST / COMMENT logic for blog post pages.
   Loaded as an ES module: <script type="module" src="blog-social.js"></script>

   Backend: Firebase Firestore (v10 modular, ESM CDN).
   Data model:
     collection "posts" -> doc {postId}         field: likes (number)
       subcollection "comments" -> docs { name, text, ts (serverTimestamp),
                                          likes (number) }
   Before real keys are pasted the page still works: likes fall back to
   localStorage-only and a subtle note is shown.
   =========================================================================== */

// >>> PASTE YOUR FIREBASE WEB CONFIG HERE <<<
// Replace every "PASTE" below with the value from your Firebase project's
// web-app config (Firebase console -> Project settings -> Your apps -> SDK
// setup and configuration). All 6 values are required for likes/comments to
// go live and persist across visitors.
const firebaseConfig = {
    /* FIREBASE_CONFIG_PLACEHOLDER */
    apiKey: "PASTE",
    authDomain: "PASTE",
    projectId: "PASTE",
    storageBucket: "PASTE",
    messagingSenderId: "PASTE",
    appId: "PASTE"
};

// ---------------------------------------------------------------------------
// postId: namespace likes + comments per post, derived from the page path.
// e.g. /blogs/beyond-the-singularity.html -> "beyond-the-singularity"
// ---------------------------------------------------------------------------
const postId = (() => {
    const file = location.pathname.split("/").pop() || "index";
    return file.replace(/\.html?$/i, "") || "index";
})();

const CONFIGURED = firebaseConfig.apiKey && firebaseConfig.apiKey !== "PASTE";
const LS_LIKE_KEY = "blogLiked:" + postId;      // this visitor liked the post
const LS_COUNT_KEY = "blogLikeCount:" + postId; // local-only fallback count
const LS_CLIKE_PREFIX = "blogCLiked:" + postId + ":"; // liked comment ids

// Firebase handles (populated only when configured)
let db = null;
let fb = null; // { doc, getDoc, setDoc, updateDoc, increment, collection,
               //   addDoc, deleteDoc, onSnapshot, query, orderBy, serverTimestamp }

// ---------------------------------------------------------------------------
// SVG icons (inline)
// ---------------------------------------------------------------------------
const ICON = {
    heart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6.7-4.35-9.3-8.05C.9 10.2 1.4 6.9 4.1 5.6c2-1 4.2-.3 5.4 1.3L12 9l2.5-2.1c1.2-1.6 3.4-2.3 5.4-1.3 2.7 1.3 3.2 4.6 1.4 7.35C18.7 16.65 12 21 12 21z"/></svg>',
    repost: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 2l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>',
    comment: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
    trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14"/></svg>',
    heartSmall: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6.7-4.35-9.3-8.05C.9 10.2 1.4 6.9 4.1 5.6c2-1 4.2-.3 5.4 1.3L12 9l2.5-2.1c1.2-1.6 3.4-2.3 5.4-1.3 2.7 1.3 3.2 4.6 1.4 7.35C18.7 16.65 12 21 12 21z"/></svg>'
};

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------
function esc(s) {
    return String(s == null ? "" : s)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function relTime(date) {
    if (!date) return "just now";
    const diff = (Date.now() - date.getTime()) / 1000;
    if (diff < 60) return "just now";
    if (diff < 3600) return Math.floor(diff / 60) + "m ago";
    if (diff < 86400) return Math.floor(diff / 3600) + "h ago";
    if (diff < 604800) return Math.floor(diff / 86400) + "d ago";
    return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

let toastTimer = null;
function showToast(msg) {
    let t = document.querySelector(".bs-toast");
    if (!t) {
        t = document.createElement("div");
        t.className = "bs-toast";
        document.body.appendChild(t);
    }
    t.textContent = msg;
    // force reflow so the transition replays
    void t.offsetWidth;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2000);
}

// ===========================================================================
// Build the interaction bar
// ===========================================================================
function buildBar() {
    const bar = document.getElementById("blog-interaction-bar");
    if (!bar) return;
    bar.classList.add("blog-interaction-bar");

    const liked = localStorage.getItem(LS_LIKE_KEY) === "1";

    bar.innerHTML =
        '<button type="button" class="bs-btn bs-like-btn' + (liked ? " liked" : "") +
            '" aria-pressed="' + (liked ? "true" : "false") + '" aria-label="Like this post">' +
            ICON.heart + '<span class="bs-count" id="bs-like-count">0</span></button>' +
        '<button type="button" class="bs-btn bs-repost-btn" aria-label="Copy link to this post">' +
            ICON.repost + '<span>Repost</span></button>' +
        '<button type="button" class="bs-btn bs-comment-btn" aria-label="Jump to comments">' +
            ICON.comment + '<span>Leave comment</span></button>' +
        (CONFIGURED ? "" :
            '<span class="bs-config-note">(comments/likes go live once Firebase is configured)</span>');

    const likeBtn = bar.querySelector(".bs-like-btn");
    const countEl = bar.querySelector("#bs-like-count");
    const repostBtn = bar.querySelector(".bs-repost-btn");
    const commentBtn = bar.querySelector(".bs-comment-btn");

    // ---- LIKE ----
    likeBtn.addEventListener("click", () => onLikePost(likeBtn, countEl));

    // ---- REPOST (copy link) ----
    repostBtn.addEventListener("click", async () => {
        try {
            await navigator.clipboard.writeText(location.href);
        } catch (e) {
            // fallback for older browsers / non-secure contexts
            const ta = document.createElement("textarea");
            ta.value = location.href;
            ta.style.position = "fixed";
            ta.style.opacity = "0";
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand("copy"); } catch (_) {}
            document.body.removeChild(ta);
        }
        showToast("Link copied to clipboard!");
    });

    // ---- COMMENT (scroll + focus) ----
    commentBtn.addEventListener("click", () => {
        const sec = document.getElementById("blog-comments");
        if (sec) sec.scrollIntoView({ behavior: "smooth", block: "start" });
        const ta = document.getElementById("bs-comment-text");
        if (ta) setTimeout(() => ta.focus(), 500);
    });

    // initialise like count
    initLikeCount(countEl);
}

function initLikeCount(countEl) {
    if (CONFIGURED && db) {
        // live-sync the global like count
        const ref = fb.doc(db, "posts", postId);
        fb.onSnapshot(ref, (snap) => {
            const n = (snap.exists() && typeof snap.data().likes === "number") ? snap.data().likes : 0;
            countEl.textContent = n;
        }, () => { /* ignore read errors */ });
    } else {
        countEl.textContent = localStorage.getItem(LS_COUNT_KEY) || "0";
    }
}

async function onLikePost(btn, countEl) {
    const wasLiked = localStorage.getItem(LS_LIKE_KEY) === "1";
    const nowLiked = !wasLiked;
    const delta = nowLiked ? 1 : -1;

    // optimistic UI
    localStorage.setItem(LS_LIKE_KEY, nowLiked ? "1" : "0");
    btn.classList.toggle("liked", nowLiked);
    btn.setAttribute("aria-pressed", nowLiked ? "true" : "false");

    if (CONFIGURED && db) {
        try {
            const ref = fb.doc(db, "posts", postId);
            // ensure the doc exists, then atomically bump the counter
            await fb.setDoc(ref, {}, { merge: true });
            await fb.updateDoc(ref, { likes: fb.increment(delta) });
        } catch (e) {
            console.warn("[blog-social] like failed:", e);
        }
    } else {
        const cur = parseInt(localStorage.getItem(LS_COUNT_KEY) || "0", 10) + delta;
        const clamped = Math.max(0, cur);
        localStorage.setItem(LS_COUNT_KEY, String(clamped));
        countEl.textContent = clamped;
    }
}

// ===========================================================================
// Comments
// ===========================================================================
function buildComments() {
    const sec = document.getElementById("blog-comments");
    if (!sec) return;
    sec.classList.add("blog-comments");

    sec.innerHTML =
        '<h2>Comments</h2>' +
        (CONFIGURED ? "" :
            '<p class="bs-comments-note">Comments go live once Firebase is configured. ' +
            'Your message will not be saved yet.</p>') +
        '<form class="bs-comment-form" id="bs-comment-form">' +
            '<input type="text" id="bs-comment-name" placeholder="Name (optional)" ' +
                'autocomplete="name" maxlength="80">' +
            '<textarea id="bs-comment-text" placeholder="Leave a comment..." ' +
                'required maxlength="4000"></textarea>' +
            '<button type="submit" id="bs-comment-submit">Post comment</button>' +
        '</form>' +
        '<ul class="bs-comment-list" id="bs-comment-list">' +
            '<li class="bs-empty">No comments yet. Be the first to comment!</li>' +
        '</ul>';

    const form = sec.querySelector("#bs-comment-form");
    form.addEventListener("submit", onPostComment);

    if (CONFIGURED && db) subscribeComments();
}

function commentsCol() {
    return fb.collection(db, "posts", postId, "comments");
}

function subscribeComments() {
    const q = fb.query(commentsCol(), fb.orderBy("ts", "desc"));
    fb.onSnapshot(q, (snap) => {
        const list = document.getElementById("bs-comment-list");
        if (!list) return;
        if (snap.empty) {
            list.innerHTML = '<li class="bs-empty">No comments yet. Be the first to comment!</li>';
            return;
        }
        const items = [];
        snap.forEach((docSnap) => {
            const c = docSnap.data();
            const ts = c.ts && typeof c.ts.toDate === "function" ? c.ts.toDate() : null;
            const likes = typeof c.likes === "number" ? c.likes : 0;
            const cliked = localStorage.getItem(LS_CLIKE_PREFIX + docSnap.id) === "1";
            items.push(renderComment(docSnap.id, c.name, c.text, ts, likes, cliked));
        });
        list.innerHTML = items.join("");
        wireCommentActions(list);
    }, (e) => console.warn("[blog-social] comments read failed:", e));
}

function renderComment(id, name, text, ts, likes, cliked) {
    return (
        '<li class="bs-comment" data-id="' + esc(id) + '">' +
            '<div class="bs-comment-head">' +
                '<span class="bs-comment-author">' + esc(name || "Anonymous") + '</span>' +
                '<span class="bs-comment-time">' + esc(relTime(ts)) + '</span>' +
            '</div>' +
            '<div class="bs-comment-text">' + esc(text) + '</div>' +
            '<div class="bs-comment-actions">' +
                '<button type="button" class="bs-clike' + (cliked ? " liked" : "") +
                    '" data-id="' + esc(id) + '" aria-label="Like comment">' +
                    ICON.heartSmall + '<span class="bs-clike-count">' + likes + '</span></button>' +
                '<button type="button" class="bs-cdelete" data-id="' + esc(id) +
                    '" aria-label="Delete comment">' + ICON.trash + '<span>Delete</span></button>' +
            '</div>' +
        '</li>'
    );
}

function wireCommentActions(list) {
    list.querySelectorAll(".bs-clike").forEach((b) => {
        b.addEventListener("click", () => onLikeComment(b.dataset.id));
    });
    list.querySelectorAll(".bs-cdelete").forEach((b) => {
        b.addEventListener("click", () => onDeleteComment(b.dataset.id));
    });
}

async function onPostComment(e) {
    e.preventDefault();
    const nameEl = document.getElementById("bs-comment-name");
    const textEl = document.getElementById("bs-comment-text");
    const submit = document.getElementById("bs-comment-submit");
    const text = (textEl.value || "").trim();
    if (!text) return;
    const name = (nameEl.value || "").trim() || "Anonymous";

    if (!(CONFIGURED && db)) {
        showToast("Configure Firebase to post comments.");
        return;
    }

    submit.disabled = true;
    try {
        await fb.addDoc(commentsCol(), {
            name: name,
            text: text,
            likes: 0,
            ts: fb.serverTimestamp()
        });
        textEl.value = "";
        // keep name for convenience
    } catch (err) {
        console.warn("[blog-social] post comment failed:", err);
        showToast("Could not post comment.");
    } finally {
        submit.disabled = false;
    }
}

async function onLikeComment(id) {
    if (!(CONFIGURED && db)) return;
    const key = LS_CLIKE_PREFIX + id;
    const wasLiked = localStorage.getItem(key) === "1";
    const nowLiked = !wasLiked;
    const delta = nowLiked ? 1 : -1;
    localStorage.setItem(key, nowLiked ? "1" : "0");
    try {
        await fb.updateDoc(fb.doc(db, "posts", postId, "comments", id), {
            likes: fb.increment(delta)
        });
    } catch (e) {
        console.warn("[blog-social] like comment failed:", e);
    }
}

async function onDeleteComment(id) {
    if (!(CONFIGURED && db)) return;
    if (!confirm("Delete this comment?")) return;
    try {
        await fb.deleteDoc(fb.doc(db, "posts", postId, "comments", id));
    } catch (e) {
        console.warn("[blog-social] delete comment failed:", e);
        showToast("Could not delete comment.");
    }
}

// ===========================================================================
// Boot
// ===========================================================================
async function boot() {
    if (CONFIGURED) {
        try {
            const appMod = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js");
            const fsMod = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
            const app = appMod.initializeApp(firebaseConfig);
            db = fsMod.getFirestore(app);
            fb = {
                doc: fsMod.doc, getDoc: fsMod.getDoc, setDoc: fsMod.setDoc,
                updateDoc: fsMod.updateDoc, increment: fsMod.increment,
                collection: fsMod.collection, addDoc: fsMod.addDoc,
                deleteDoc: fsMod.deleteDoc, onSnapshot: fsMod.onSnapshot,
                query: fsMod.query, orderBy: fsMod.orderBy,
                serverTimestamp: fsMod.serverTimestamp
            };
        } catch (e) {
            console.warn("[blog-social] Firebase init failed; falling back to local-only:", e);
            db = null; fb = null;
        }
    }
    buildBar();
    buildComments();
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
} else {
    boot();
}
