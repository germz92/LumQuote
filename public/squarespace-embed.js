/*
 * Runs on the Squarespace page (code block or footer code injection).
 * Squarespace Embed blocks pin iframes to a 16:9 box with position:absolute,
 * so on a phone the form draws on top of the blocks under it. This listens
 * for the form's height and puts that iframe back in normal flow.
 */
(function () {
    if (window.__lumquoteSquarespaceEmbed) return;
    window.__lumquoteSquarespaceEmbed = true;

    var FRAMES = [
        { type: 'lumquote-inquire-height', path: /\/inquire(?:[?#]|$)/, min: 400, max: 5000 },
        { type: 'lumquote-estimate-height', path: /\/estimate(?:[?#]|$)/, min: 300, max: 3000 }
    ];

    function frameKind(frame) {
        var src = frame.getAttribute('src') || '';
        for (var i = 0; i < FRAMES.length; i++) {
            if (FRAMES[i].path.test(src)) return FRAMES[i];
        }
        return null;
    }

    function originOf(frame) {
        try {
            return new URL(frame.src, window.location.href).origin;
        } catch (error) {
            return '';
        }
    }

    function fitFrame(frame, height) {
        frame.style.setProperty('position', 'relative', 'important');
        frame.style.setProperty('top', 'auto', 'important');
        frame.style.setProperty('left', 'auto', 'important');
        frame.style.setProperty('right', 'auto', 'important');
        frame.style.setProperty('bottom', 'auto', 'important');
        frame.style.setProperty('width', '100%', 'important');
        frame.style.setProperty('height', height + 'px', 'important');
        frame.style.setProperty('min-height', '0', 'important');
        frame.style.setProperty('max-height', 'none', 'important');
        frame.style.setProperty('display', 'block', 'important');

        var node = frame.parentElement;
        for (var i = 0; node && node !== document.body && i < 6; i++) {
            if (node.classList && (
                node.classList.contains('embed-block-wrapper') ||
                node.classList.contains('intrinsic') ||
                node.classList.contains('sqs-embed-container') ||
                node.classList.contains('sqs-block-content')
            )) {
                node.style.setProperty('position', 'relative', 'important');
                node.style.setProperty('height', 'auto', 'important');
                node.style.setProperty('padding-bottom', '0', 'important');
                node.style.setProperty('overflow', 'visible', 'important');
            }
            node = node.parentElement;
        }

        var wrap = frame.closest ? frame.closest('.embed-block-wrapper') : null;
        if (wrap) wrap.style.setProperty('height', height + 'px', 'important');
        frame.dataset.lqHeight = String(height);
    }

    function requestHeight(frame) {
        var kind = frameKind(frame);
        var origin = originOf(frame);
        if (!kind || !origin || !frame.contentWindow) return;
        var type = kind.type === 'lumquote-estimate-height'
            ? 'lumquote-estimate-height-request'
            : 'lumquote-inquire-height-request';
        frame.contentWindow.postMessage({ type: type }, origin);
    }

    function prepare(frame) {
        if (frame.dataset.lqReady === '1') return;
        frame.dataset.lqReady = '1';
        var current = (frame.offsetHeight || 640) + 1;
        fitFrame(frame, current);
        requestHeight(frame);
        frame.addEventListener('load', function () {
            requestHeight(frame);
        });
    }

    function scan() {
        var frames = document.querySelectorAll('iframe');
        for (var i = 0; i < frames.length; i++) {
            if (frameKind(frames[i])) prepare(frames[i]);
        }
    }

    window.addEventListener('message', function (event) {
        var data = event.data || {};
        var frames = document.querySelectorAll('iframe');
        for (var i = 0; i < frames.length; i++) {
            var frame = frames[i];
            var kind = frameKind(frame);
            if (!kind || data.type !== kind.type) continue;
            if (event.source && frame.contentWindow && event.source !== frame.contentWindow) continue;
            if (originOf(frame) && event.origin !== originOf(frame)) continue;
            var height = Math.ceil(Number(data.height));
            if (!(height > kind.min && height < kind.max)) continue;
            if (frame.dataset.lqContentHeight === String(height)) continue;
            frame.dataset.lqContentHeight = String(height);
            fitFrame(frame, height + 4);
        }
    });

    var scheduled = false;
    function scheduleScan() {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(function () {
            scheduled = false;
            scan();
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', scheduleScan);
    } else {
        scheduleScan();
    }
    window.addEventListener('load', scheduleScan);

    if (window.MutationObserver) {
        new MutationObserver(scheduleScan).observe(document.documentElement, {
            childList: true,
            subtree: true
        });
    }
})();
