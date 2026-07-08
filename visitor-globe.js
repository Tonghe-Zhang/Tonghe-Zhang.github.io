/* ===========================================================================
   visitor-globe.js — global visitor counter + 3D globe with a glowing dot at
   each visitor's location.

   Robust / self-contained:
     • Globe library (globe.gl + three.js) is VENDORED at lib/globe.gl.min.js
       and the earth texture at lib/earth-night.jpg — the globe renders even
       if every external service/CDN is down.
     • A committed snapshot (visitor-data.json) is the FALLBACK: if the live
       store is unreachable, the globe still shows the last-known count + dots.
     • Live global count + dots use restful-api.dev when reachable; each browser
       is counted once (localStorage flag). If the store ever shuts down, the
       site is unaffected — it just stops incrementing and shows the snapshot.
     • Visitor location via ipapi.co (best-effort; skipped if blocked).
   =========================================================================== */
(function () {
    var API = "https://api.restful-api.dev/objects/ff8081819d82fab6019f4340ebaf3585";
    var SNAPSHOT = "visitor-data.json";       // committed fallback
    var LS_DONE = "visitorCounted:v1";
    var MAX_POINTS = 5000;

    var elCount = document.getElementById("visitor-count");
    var elGlobe = document.getElementById("visitor-globe");
    if (!elGlobe) return;

    function fmt(n) { return (n || 0).toLocaleString(); }
    function norm(d) {
        d = d || {};
        return { count: typeof d.count === "number" ? d.count : 0,
                 points: Array.isArray(d.points) ? d.points : [] };
    }

    function loadSnapshot() {
        return fetch(SNAPSHOT, { cache: "no-cache" })
            .then(function (r) { return r.json(); })
            .then(norm).catch(function () { return { count: 0, points: [] }; });
    }
    function loadLive() {
        return fetch(API, { headers: { "Accept": "application/json" } })
            .then(function (r) { return r.json(); })
            .then(function (j) { return norm(j && j.data); });
    }
    function saveLive(s) {
        return fetch(API, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: "thz-visitors", data: s })
        });
    }
    function getLoc() {
        return fetch("https://ipapi.co/json/")
            .then(function (r) { return r.json(); })
            .then(function (j) {
                return (typeof j.latitude === "number" && typeof j.longitude === "number")
                    ? { lat: j.latitude, lng: j.longitude } : null;
            }).catch(function () { return null; });
    }

    var globe = null;
    function renderGlobe(points) {
        if (typeof Globe === "undefined") { elGlobe.classList.add("globe-unavailable"); return; }
        var data = (points || []).map(function (p) { return { lat: p.lat, lng: p.lng }; });
        if (!globe) {
            var dark = document.body.getAttribute("data-theme") === "dark";
            globe = Globe()(elGlobe)
                .backgroundColor("rgba(0,0,0,0)")
                .showGlobe(true)
                .showAtmosphere(true)
                .atmosphereColor(dark ? "#3f86d0" : "#9ccaf5")
                .atmosphereAltitude(0.28)
                .globeImageUrl(null)
                .width(elGlobe.clientWidth)
                .height(elGlobe.clientHeight)
                // continents as flat sky-blue polygons (no terrain photo)
                .polygonCapColor(function () { return dark ? "#2f6fb0" : "#7fb3e8"; })
                .polygonSideColor(function () { return "rgba(0,0,0,0)"; })
                .polygonStrokeColor(function () { return dark ? "#4f96e0" : "#5b9bd8"; })
                .polygonAltitude(0.008)
                // visitor dots
                .pointsData(data)
                .pointLat("lat").pointLng("lng")
                .pointColor(function () { return "#ff5a5a"; })
                .pointAltitude(0.03)
                .pointRadius(0.5);
            // pale ocean sphere (mutate existing material — no THREE constructor)
            try {
                var mat = globe.globeMaterial();
                mat.color.set(dark ? "#0e2233" : "#eaf4ff");
                if ("shininess" in mat) mat.shininess = 3;
                mat.transparent = true; mat.opacity = dark ? 0.95 : 0.96;
            } catch (e) {}
            globe.pointOfView({ lat: 20, lng: 10, altitude: 2.4 }, 0);
            var c = globe.controls();
            c.autoRotate = true; c.autoRotateSpeed = 0.6; c.enableZoom = false;
            fetch("lib/countries.geojson").then(function (r) { return r.json(); })
                .then(function (geo) {
                    var feats = geo.features.filter(function (f) {
                        return f.properties && f.properties.ISO_A2 !== "AQ"; // drop Antarctica
                    });
                    globe.polygonsData(feats);
                }).catch(function () {});
        } else {
            globe.pointsData(data);
        }
    }
    window.addEventListener("resize", function () {
        if (globe) globe.width(elGlobe.clientWidth).height(elGlobe.clientHeight);
    });

    function show(s) {
        renderGlobe(s.points);
        if (elCount) elCount.textContent = fmt(s.count);
    }

    // 1) paint immediately from the committed snapshot (always available)
    loadSnapshot().then(function (snap) {
        show(snap);

        // 2) try the live store; on success show live + count this browser once
        loadLive().then(function (live) {
            // merge: live is source of truth when reachable
            show(live);
            if (localStorage.getItem(LS_DONE) === "1") return;
            getLoc().then(function (loc) {
                loadLive().then(function (cur) {
                    cur.count = (cur.count || 0) + 1;
                    if (loc) {
                        cur.points = cur.points || [];
                        cur.points.push({ lat: loc.lat, lng: loc.lng, t: Date.now() });
                        if (cur.points.length > MAX_POINTS) cur.points = cur.points.slice(-MAX_POINTS);
                    }
                    saveLive(cur).then(function () {
                        try { localStorage.setItem(LS_DONE, "1"); } catch (e) {}
                        show(cur);
                    });
                }).catch(function () {});
            });
        }).catch(function () {
            /* live store down — snapshot already shown; site unaffected */
        });
    });
})();
