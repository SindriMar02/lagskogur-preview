/* ============================================================================
   THE STAY PICKER, vanilla edition.

   Same device as iceland-redesigns/src/preview/{svartlodge,nollur}/StayPicker.tsx
   and 02-clients/aurora-hills/src/components/StayPicker.tsx: the 21st.dev
   two-month range picker (component 25129 — two months side by side, the
   check-in → check-out read-back, the nights count) plus the four things a
   STAY picker needs that a meeting picker does not:

     1. the past blocked,
     2. a three-rule click machine, so a third click restarts and no "clear"
        button is needed,
     3. a minimum stay enforced AT SELECTION, naming the earliest legal
        checkout out loud rather than dying on a silent dead click,
     4. a hover preview, so the guest can see the range they are drawing
        before the second click lands.

   Geometry rules that are not negotiable and were paid for on real devices:
   cells are FLUSH (row-gap only) or the range bar breaks into seven pieces;
   the fill is painted on a ::before so the numeral stays above it; the grid is
   ALWAYS six rows or the panel jumps height when you page; one month below
   620px, because two 7-column grids on a phone give unusable cells.

   Styling is entirely the host build's, via `prefix`. This file ships no
   colours.
   ========================================================================== */
(function (global) {
  var DAY = 86400000;

  function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
  function addMonths(d, n) { return new Date(d.getFullYear(), d.getMonth() + n, 1); }
  function nights(a, b) { return Math.round((b - a) / DAY); }
  function same(a, b) { return !!a && !!b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
  function key(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

  function grid42(month) {
    var first = new Date(month.getFullYear(), month.getMonth(), 1);
    var lead = (first.getDay() + 6) % 7;
    var cells = [];
    for (var i = 0; i < 42; i++) {
      var d = addDays(first, i - lead);
      cells.push({ date: d, inMonth: d.getMonth() === month.getMonth() });
    }
    return cells;
  }

  /**
   * @param {Object} o
   * @param {Element} o.mount        container to render into
   * @param {string}  o.prefix       CSS class prefix, e.g. 'lg-stay'
   * @param {number}  [o.minStay=2]  minimum nights
   * @param {Object}  o.L            labels
   * @param {Function}[o.onChange]   called with { start, end, nights }
   */
  global.createStayPicker = function (o) {
    var L = o.L, prefix = o.prefix, minStay = o.minStay || 2;
    var mount = o.mount;
    var today = startOfDay(new Date());
    /* Open on a month that can still be booked: landing on the 30th shows a
       grid that is almost entirely greyed-out past, which reads as a fully
       booked house rather than as a month that has simply run out. */
    var endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    var view = new Date(today.getFullYear(), today.getMonth() + (((endOfMonth - today) / DAY < 7) ? 1 : 0), 1);
    var start = null, end = null, hover = null, note = null;

    var c = function (n) { return prefix + '-' + n; };
    mount.classList.add(prefix);
    mount.innerHTML =
      '<div class="' + c('head') + '">' +
        '<button type="button" class="' + c('arrow') + '" data-prev aria-label="' + L.prevMonth + '"><i class="' + c('chev') + ' ' + c('chev') + '--l"></i></button>' +
        '<p class="' + c('months') + '" aria-live="polite"></p>' +
        '<button type="button" class="' + c('arrow') + '" data-next aria-label="' + L.nextMonth + '"><i class="' + c('chev') + ' ' + c('chev') + '--r"></i></button>' +
      '</div>' +
      '<div class="' + c('grids') + '"></div>' +
      '<div class="' + c('read') + '">' +
        '<div class="' + c('cell') + '" data-cell-in><span class="' + c('cell-l') + '">' + L.checkIn + '</span><span class="' + c('cell-v') + '"></span></div>' +
        '<span class="' + c('nights') + '" aria-live="polite"></span>' +
        '<div class="' + c('cell') + '" data-cell-out><span class="' + c('cell-l') + '">' + L.checkOut + '</span><span class="' + c('cell-v') + '"></span></div>' +
      '</div>' +
      '<p class="' + c('note') + '" role="status"></p>';

    var elMonths = mount.querySelector('.' + c('months'));
    var elGrids = mount.querySelector('.' + c('grids'));
    var elIn = mount.querySelector('[data-cell-in] .' + c('cell-v'));
    var elOut = mount.querySelector('[data-cell-out] .' + c('cell-v'));
    var elNights = mount.querySelector('.' + c('nights'));
    var elNote = mount.querySelector('.' + c('note'));
    var btnPrev = mount.querySelector('[data-prev]');
    var btnNext = mount.querySelector('[data-next]');

    function fmtLong(d) { return d.getDate() + ' ' + L.months[d.getMonth()] + ' ' + d.getFullYear(); }
    function fmtShort(d) { return L.weekdays[(d.getDay() + 6) % 7] + ' ' + d.getDate() + ' ' + L.months[d.getMonth()].slice(0, 3); }

    function pick(d) {
      if (d < today) return;
      /* Rule 1 — nothing chosen, or a finished range: start again. */
      if (!start || (start && end)) { start = d; end = null; note = null; }
      /* Rule 2 — on or before the start is a NEW start, not a backwards range. */
      else if (d <= start) { start = d; end = null; note = null; }
      /* Rule 3 — complete it, if the nights between allow. */
      else if (nights(start, d) < minStay) { note = L.minStay(fmtLong(addDays(start, minStay))); }
      else { end = d; note = null; }
      render();
      if (o.onChange) o.onChange({ start: start, end: end, nights: (start && end) ? nights(start, end) : 0 });
    }

    function render() {
      var m2 = addMonths(view, 1);
      elMonths.innerHTML = L.months[view.getMonth()] + ' ' + view.getFullYear() +
        '<span class="' + c('month2') + '"> · ' + L.months[m2.getMonth()] + ' ' + m2.getFullYear() + '</span>';
      btnPrev.disabled = view <= new Date(today.getFullYear(), today.getMonth(), 1);

      /* While the checkout is being chosen, the row under the cursor paints as
         if it were the range; a picker that shows nothing until the second
         click makes the guest guess how long a stay they are drawing. */
      var previewEnd = (start && !end && hover && hover > start) ? hover : null;
      var to = end || previewEnd;

      var html = '';
      [view, m2].forEach(function (m, mi) {
        html += '<div class="' + c('grid') + (mi === 1 ? ' ' + c('grid') + '--2' : '') + '">' +
          '<div class="' + c('dows') + '" aria-hidden="true">' +
            L.weekdays.map(function (w) { return '<span>' + w.slice(0, 1) + '</span>'; }).join('') +
          '</div>' +
          '<div class="' + c('days') + '" role="group" aria-label="' + L.months[m.getMonth()] + ' ' + m.getFullYear() + '">';
        grid42(m).forEach(function (cell) {
          var d = cell.date;
          if (!cell.inMonth) { html += '<span class="' + c('day') + ' is-out" aria-hidden="true"></span>'; return; }
          var past = d < today;
          var isS = same(d, start), isE = same(d, end);
          var mid = !!start && !!to && d > start && d < to;
          var cls = [c('day')];
          if (past) cls.push('is-past');
          if (isS) cls.push('is-start');
          if (isE) cls.push('is-end');
          if (mid) cls.push('is-mid');
          if (same(d, today)) cls.push('is-today');
          html += '<button type="button" class="' + cls.join(' ') + '"' + (past ? ' disabled tabindex="-1"' : '') +
            ' data-d="' + key(d) + '" aria-label="' + fmtLong(d) + (isS ? ', ' + L.checkIn : '') + (isE ? ', ' + L.checkOut : '') + '"' +
            (isS || isE ? ' aria-pressed="true"' : '') + '><span class="' + c('n') + '">' + d.getDate() + '</span></button>';
        });
        html += '</div></div>';
      });
      elGrids.innerHTML = html;

      elIn.textContent = start ? fmtShort(start) : L.pickDate;
      elOut.textContent = end ? fmtShort(end) : (start ? L.pickDate : L.afterCheckIn);
      mount.querySelector('[data-cell-in]').toggleAttribute('data-filled', !!start);
      mount.querySelector('[data-cell-out]').toggleAttribute('data-filled', !!end);
      var n = (start && end) ? nights(start, end) : 0;
      elNights.textContent = n > 0 ? (n + ' ' + (n === 1 ? L.night : L.nights)) : '';
      elNote.textContent = note || (n > 0 ? L.chosen(fmtLong(start), fmtLong(end)) : L.empty);
    }

    elGrids.addEventListener('click', function (e) {
      var b = e.target.closest('.' + c('day'));
      if (!b || b.disabled || !b.dataset.d) return;
      pick(new Date(b.dataset.d + 'T00:00:00'));
    });
    elGrids.addEventListener('pointerover', function (e) {
      var b = e.target.closest('.' + c('day'));
      if (!b || !b.dataset.d) return;
      var d = new Date(b.dataset.d + 'T00:00:00');
      if (!same(d, hover)) { hover = d; if (start && !end) render(); }
    });
    elGrids.addEventListener('pointerleave', function () { if (hover) { hover = null; if (start && !end) render(); } });
    btnPrev.addEventListener('click', function () { view = addMonths(view, -1); render(); });
    btnNext.addEventListener('click', function () { view = addMonths(view, 1); render(); });

    render();
    return {
      get: function () { return { start: start, end: end, nights: (start && end) ? nights(start, end) : 0 }; },
      fmtLong: fmtLong,
      key: key,
      reset: function () { start = null; end = null; note = null; render(); },
    };
  };
})(window);
