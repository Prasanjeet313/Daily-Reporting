/* =====================================================================
   DVC TUBED COAL MINES - ROSTER ENGINE
   ---------------------------------------------------------------------
   Turns roster-config.js into the two things the pages need:

       RosterEngine.employees()   -> the staff list, in sheet order
       RosterEngine.shiftsByDate() -> { "YYYY-MM-DD": [ shift per employee ] }

   You should not need to edit this file. All roster changes belong in
   roster-config.js.
   ===================================================================== */

(function (global) {
  "use strict";

  var CFG = global.ROSTER_CONFIG;
  if (!CFG) {
    throw new Error("roster-config.js must be loaded before roster-engine.js");
  }

  var DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  function dayName(iso) {
    return DAY_NAMES[new Date(iso + "T00:00:00").getDay()];
  }

  function addDays(iso, n) {
    var d = new Date(iso + "T00:00:00");
    d.setDate(d.getDate() + n);
    return d.getFullYear() + "-" +
           String(d.getMonth() + 1).padStart(2, "0") + "-" +
           String(d.getDate()).padStart(2, "0");
  }

  /* Every date the pages should offer: the configured range, which always
     covers every date mentioned by a roster block. */
  function allDates() {
    var first = CFG.meta.dateMin, last = CFG.meta.dateMax;
    CFG.rosterBlocks.forEach(function (b) {
      Object.keys(b.days).forEach(function (d) {
        if (d < first) first = d;
        if (d > last) last = d;
      });
    });
    var out = [], d = first;
    while (d <= last) { out.push(d); d = addDays(d, 1); }
    return out;
  }

  /* ---------------- employees ---------------- */
  var order = {};
  CFG.meta.sections.forEach(function (s, i) { order[s] = i; });

  var EMPLOYEES = CFG.employees.map(function (e, i) {
    return {
      id: e.id,            // Manpower_Intimation uses .id / .so
      empId: e.id,         // Attendance uses .empId / .sort
      so: i + 1,
      sort: i + 1,
      name: e.name,
      desig: e.desig,
      loc: e.section
    };
  }).sort(function (a, b) {
    var ra = order[a.loc], rb = order[b.loc];
    if (ra === undefined) ra = 99;
    if (rb === undefined) rb = 99;
    return ra - rb || a.sort - b.sort;
  }).map(function (e, i) {
    e.so = e.sort = i + 1;         // renumber after sorting so the order is stable
    return e;
  });

  var INDEX = {};
  EMPLOYEES.forEach(function (e, i) { INDEX[e.id] = i; });

  /* ---------------- shifts ---------------- */
  function buildShifts() {
    var dates = allDates();
    var table = {};
    dates.forEach(function (d) {
      table[d] = EMPLOYEES.map(function () { return ""; });
    });

    // 1. roster blocks, in order - a later block overwrites an earlier one
    CFG.rosterBlocks.forEach(function (block) {
      var cols = block.people.map(function (id) {
        var at = INDEX[id];
        if (at === undefined) {
          if (global.console) console.warn("roster block '" + block.id +
            "' lists employee id " + id + ", who is not in employees[]");
          return -1;
        }
        return at;
      });
      Object.keys(block.days).forEach(function (date) {
        if (block.from && date < block.from) return;
        if (block.to && date > block.to) return;
        if (!table[date]) return;
        var codes = String(block.days[date]).trim().split(/\s+/);
        cols.forEach(function (at, k) {
          if (at < 0) return;
          var code = codes[k];
          if (!code || code === "-") return;
          table[date][at] = code;
        });
      });
    });

    // 2. standing postings (General Shift and the like)
    (CFG.standingDuty || []).forEach(function (rule) {
      var off = {};
      (rule.weeklyOff || []).forEach(function (d) { off[d] = true; });
      rule.ids.forEach(function (id) {
        var at = INDEX[id];
        if (at === undefined) return;
        dates.forEach(function (date) {
          if (rule.from && date < rule.from) return;
          if (rule.to && date > rule.to) return;
          table[date][at] = off[dayName(date)] ? "OFF" : rule.shift;
        });
      });
    });

    // 3. one-off changes
    Object.keys(CFG.overrides || {}).forEach(function (date) {
      if (!table[date]) return;
      var row = CFG.overrides[date];
      Object.keys(row).forEach(function (id) {
        var at = INDEX[id];
        if (at !== undefined) table[date][at] = row[id];
      });
    });

    return table;
  }

  var SHIFTS = buildShifts();

  /* ---------------- public surface ---------------- */
  global.RosterEngine = {
    employees: function () { return EMPLOYEES; },
    shiftsByDate: function () { return SHIFTS; },
    sections: function () { return CFG.meta.sections.slice(); },
    hiddenSections: function () { return (CFG.meta.hiddenInAttendance || []).slice(); },
    dateMin: function () { return CFG.meta.dateMin; },
    dateMax: function () { return CFG.meta.dateMax; },
    version: function () { return CFG.meta.version; },

    /* what one person is doing on one date - handy for debugging in the console */
    shiftFor: function (empId, date) {
      var at = INDEX[empId];
      return (at === undefined || !SHIFTS[date]) ? "" : SHIFTS[date][at];
    }
  };
})(window);
