/* =====================================================================
   DVC TUBED COAL MINES - ROSTER ENGINE
   ---------------------------------------------------------------------
   Turns roster-config.js into the things the pages need:

       RosterEngine.employees()     -> DVC staff list, in sheet order
       RosterEngine.shiftsByDate()  -> { "YYYY-MM-DD": [ shift per employee ] }
       RosterEngine.sections()      -> DVC deployment locations

       RosterEngine.crews()         -> [ DVC, Home Guards, Drivers ]
       RosterEngine.crew(id)        -> one of them

   Each crew exposes the same shape: id, label, reportTitle, sections,
   employees(), shiftsByDate(), dateRange().

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

  /* ---------------------------------------------------------------
     Shared resolver: people + roster blocks + standing duty + overrides
     -> a staff list and a date -> shifts table.
     --------------------------------------------------------------- */
  function build(people, sections, blocks, standing, overrides, minDate, maxDate) {
    var order = {};
    sections.forEach(function (s, i) { order[s] = i; });

    var staff = people.map(function (e, i) {
      var row = {};
      Object.keys(e).forEach(function (k) { row[k] = e[k]; });  // keep extras such as phone
      row.id = e.id;            // Manpower_Intimation reads .id / .so
      row.empId = e.id;         // Attendance reads .empId / .sort
      row.so = row.sort = i + 1;
      row.loc = e.section;
      return row;
    }).sort(function (a, b) {
      var ra = order[a.loc], rb = order[b.loc];
      if (ra === undefined) ra = 99;
      if (rb === undefined) rb = 99;
      return ra - rb || a.sort - b.sort;
    }).map(function (e, i) {
      e.so = e.sort = i + 1;        // renumber after sorting so the order is stable
      return e;
    });

    var index = {};
    staff.forEach(function (e, i) { index[e.id] = i; });

    // every date the roster should offer
    var first = minDate, last = maxDate;
    blocks.forEach(function (b) {
      Object.keys(b.days).forEach(function (d) {
        if (!first || d < first) first = d;
        if (!last || d > last) last = d;
      });
    });
    var dates = [], d = first;
    while (first && d <= last) { dates.push(d); d = addDays(d, 1); }

    var table = {};
    dates.forEach(function (dt) {
      table[dt] = staff.map(function () { return ""; });
    });

    // 1. roster blocks, in order - a later block overwrites an earlier one
    blocks.forEach(function (block) {
      var cols = block.people.map(function (id) {
        var at = index[id];
        if (at === undefined && global.console) {
          console.warn("roster block '" + block.id + "' lists id " + id +
                       ", who is not in its people list");
        }
        return at === undefined ? -1 : at;
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
    (standing || []).forEach(function (rule) {
      var off = {};
      (rule.weeklyOff || []).forEach(function (x) { off[x] = true; });
      rule.ids.forEach(function (id) {
        var at = index[id];
        if (at === undefined) return;
        dates.forEach(function (date) {
          if (rule.from && date < rule.from) return;
          if (rule.to && date > rule.to) return;
          table[date][at] = off[dayName(date)] ? "OFF" : rule.shift;
        });
      });
    });

    // 3. one-off changes
    Object.keys(overrides || {}).forEach(function (date) {
      if (!table[date]) return;
      var row = overrides[date];
      Object.keys(row).forEach(function (id) {
        var at = index[id];
        if (at !== undefined) table[date][at] = row[id];
      });
    });

    return { staff: staff, table: table, index: index,
             first: dates[0] || "", last: dates[dates.length - 1] || "" };
  }

  /* ---------------- the DVC roster ---------------- */
  var DVC = build(CFG.employees, CFG.meta.sections, CFG.rosterBlocks,
                  CFG.standingDuty, CFG.overrides, CFG.meta.dateMin, CFG.meta.dateMax);

  function wrap(id, label, title, sections, built, subLabel, restColumn) {
    return {
      id: id,
      label: label,
      reportTitle: title,
      subLabel: subLabel || "desig",   // what prints under each name
      restColumn: restColumn !== false,// does this crew get an OFF / REST column?
      sections: sections.slice(),
      employees: function () { return built.staff; },
      shiftsByDate: function () { return built.table; },
      dateRange: function () { return { from: built.first, to: built.last }; },
      shiftFor: function (empId, date) {
        var at = built.index[empId];
        return (at === undefined || !built.table[date]) ? "" : built.table[date][at];
      }
    };
  }

  var CREWS = [wrap("dvc", "DVC Manpower", "PLANNED MANPOWER DEPLOYMENT",
                    CFG.meta.sections, DVC)];

  (CFG.crews || []).forEach(function (c) {
    var built = build(c.people, c.sections, c.rosterBlocks,
                      c.standingDuty, c.overrides, null, null);
    CREWS.push(wrap(c.id, c.label, c.reportTitle || ("PLANNED " + c.label.toUpperCase() + " DEPLOYMENT"),
                    c.sections, built, c.subLabel, c.restColumn));
  });

  /* ---------------- public surface ---------------- */
  global.RosterEngine = {
    employees: function () { return DVC.staff; },
    shiftsByDate: function () { return DVC.table; },
    sections: function () { return CFG.meta.sections.slice(); },
    hiddenSections: function () { return (CFG.meta.hiddenInAttendance || []).slice(); },
    dateMin: function () { return CFG.meta.dateMin; },
    dateMax: function () { return CFG.meta.dateMax; },
    version: function () { return CFG.meta.version; },

    crews: function () { return CREWS.slice(); },
    crew: function (id) {
      return CREWS.filter(function (c) { return c.id === id; })[0] || CREWS[0];
    },

    /* what one person is doing on one date - handy for debugging in the console */
    shiftFor: function (empId, date) {
      var at = DVC.index[empId];
      return (at === undefined || !DVC.table[date]) ? "" : DVC.table[date][at];
    }
  };
})(window);
