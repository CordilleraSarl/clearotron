(function polyfill() {
  const relList = document.createElement("link").relList;
  if (relList && relList.supports && relList.supports("modulepreload")) {
    return;
  }
  for (const link of document.querySelectorAll('link[rel="modulepreload"]')) {
    processPreload(link);
  }
  new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type !== "childList") {
        continue;
      }
      for (const node of mutation.addedNodes) {
        if (node.tagName === "LINK" && node.rel === "modulepreload")
          processPreload(node);
      }
    }
  }).observe(document, { childList: true, subtree: true });
  function getFetchOpts(link) {
    const fetchOpts = {};
    if (link.integrity) fetchOpts.integrity = link.integrity;
    if (link.referrerPolicy) fetchOpts.referrerPolicy = link.referrerPolicy;
    if (link.crossOrigin === "use-credentials")
      fetchOpts.credentials = "include";
    else if (link.crossOrigin === "anonymous") fetchOpts.credentials = "omit";
    else fetchOpts.credentials = "same-origin";
    return fetchOpts;
  }
  function processPreload(link) {
    if (link.ep)
      return;
    link.ep = true;
    const fetchOpts = getFetchOpts(link);
    fetch(link.href, fetchOpts);
  }
})();
var jsxRuntime = { exports: {} };
var reactJsxRuntime_production_min = {};
var react = { exports: {} };
var react_production_min = {};
/**
 * @license React
 * react.production.min.js
 *
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
var hasRequiredReact_production_min;
function requireReact_production_min() {
  if (hasRequiredReact_production_min) return react_production_min;
  hasRequiredReact_production_min = 1;
  var l = Symbol.for("react.element"), n = Symbol.for("react.portal"), p = Symbol.for("react.fragment"), q = Symbol.for("react.strict_mode"), r = Symbol.for("react.profiler"), t = Symbol.for("react.provider"), u = Symbol.for("react.context"), v = Symbol.for("react.forward_ref"), w = Symbol.for("react.suspense"), x = Symbol.for("react.memo"), y = Symbol.for("react.lazy"), z = Symbol.iterator;
  function A(a) {
    if (null === a || "object" !== typeof a) return null;
    a = z && a[z] || a["@@iterator"];
    return "function" === typeof a ? a : null;
  }
  var B = { isMounted: function() {
    return false;
  }, enqueueForceUpdate: function() {
  }, enqueueReplaceState: function() {
  }, enqueueSetState: function() {
  } }, C = Object.assign, D = {};
  function E(a, b, e) {
    this.props = a;
    this.context = b;
    this.refs = D;
    this.updater = e || B;
  }
  E.prototype.isReactComponent = {};
  E.prototype.setState = function(a, b) {
    if ("object" !== typeof a && "function" !== typeof a && null != a) throw Error("setState(...): takes an object of state variables to update or a function which returns an object of state variables.");
    this.updater.enqueueSetState(this, a, b, "setState");
  };
  E.prototype.forceUpdate = function(a) {
    this.updater.enqueueForceUpdate(this, a, "forceUpdate");
  };
  function F() {
  }
  F.prototype = E.prototype;
  function G(a, b, e) {
    this.props = a;
    this.context = b;
    this.refs = D;
    this.updater = e || B;
  }
  var H = G.prototype = new F();
  H.constructor = G;
  C(H, E.prototype);
  H.isPureReactComponent = true;
  var I = Array.isArray, J = Object.prototype.hasOwnProperty, K = { current: null }, L = { key: true, ref: true, __self: true, __source: true };
  function M(a, b, e) {
    var d, c = {}, k = null, h = null;
    if (null != b) for (d in void 0 !== b.ref && (h = b.ref), void 0 !== b.key && (k = "" + b.key), b) J.call(b, d) && !L.hasOwnProperty(d) && (c[d] = b[d]);
    var g = arguments.length - 2;
    if (1 === g) c.children = e;
    else if (1 < g) {
      for (var f = Array(g), m = 0; m < g; m++) f[m] = arguments[m + 2];
      c.children = f;
    }
    if (a && a.defaultProps) for (d in g = a.defaultProps, g) void 0 === c[d] && (c[d] = g[d]);
    return { $$typeof: l, type: a, key: k, ref: h, props: c, _owner: K.current };
  }
  function N(a, b) {
    return { $$typeof: l, type: a.type, key: b, ref: a.ref, props: a.props, _owner: a._owner };
  }
  function O(a) {
    return "object" === typeof a && null !== a && a.$$typeof === l;
  }
  function escape(a) {
    var b = { "=": "=0", ":": "=2" };
    return "$" + a.replace(/[=:]/g, function(a2) {
      return b[a2];
    });
  }
  var P = /\/+/g;
  function Q(a, b) {
    return "object" === typeof a && null !== a && null != a.key ? escape("" + a.key) : b.toString(36);
  }
  function R(a, b, e, d, c) {
    var k = typeof a;
    if ("undefined" === k || "boolean" === k) a = null;
    var h = false;
    if (null === a) h = true;
    else switch (k) {
      case "string":
      case "number":
        h = true;
        break;
      case "object":
        switch (a.$$typeof) {
          case l:
          case n:
            h = true;
        }
    }
    if (h) return h = a, c = c(h), a = "" === d ? "." + Q(h, 0) : d, I(c) ? (e = "", null != a && (e = a.replace(P, "$&/") + "/"), R(c, b, e, "", function(a2) {
      return a2;
    })) : null != c && (O(c) && (c = N(c, e + (!c.key || h && h.key === c.key ? "" : ("" + c.key).replace(P, "$&/") + "/") + a)), b.push(c)), 1;
    h = 0;
    d = "" === d ? "." : d + ":";
    if (I(a)) for (var g = 0; g < a.length; g++) {
      k = a[g];
      var f = d + Q(k, g);
      h += R(k, b, e, f, c);
    }
    else if (f = A(a), "function" === typeof f) for (a = f.call(a), g = 0; !(k = a.next()).done; ) k = k.value, f = d + Q(k, g++), h += R(k, b, e, f, c);
    else if ("object" === k) throw b = String(a), Error("Objects are not valid as a React child (found: " + ("[object Object]" === b ? "object with keys {" + Object.keys(a).join(", ") + "}" : b) + "). If you meant to render a collection of children, use an array instead.");
    return h;
  }
  function S(a, b, e) {
    if (null == a) return a;
    var d = [], c = 0;
    R(a, d, "", "", function(a2) {
      return b.call(e, a2, c++);
    });
    return d;
  }
  function T(a) {
    if (-1 === a._status) {
      var b = a._result;
      b = b();
      b.then(function(b2) {
        if (0 === a._status || -1 === a._status) a._status = 1, a._result = b2;
      }, function(b2) {
        if (0 === a._status || -1 === a._status) a._status = 2, a._result = b2;
      });
      -1 === a._status && (a._status = 0, a._result = b);
    }
    if (1 === a._status) return a._result.default;
    throw a._result;
  }
  var U = { current: null }, V = { transition: null }, W2 = { ReactCurrentDispatcher: U, ReactCurrentBatchConfig: V, ReactCurrentOwner: K };
  function X() {
    throw Error("act(...) is not supported in production builds of React.");
  }
  react_production_min.Children = { map: S, forEach: function(a, b, e) {
    S(a, function() {
      b.apply(this, arguments);
    }, e);
  }, count: function(a) {
    var b = 0;
    S(a, function() {
      b++;
    });
    return b;
  }, toArray: function(a) {
    return S(a, function(a2) {
      return a2;
    }) || [];
  }, only: function(a) {
    if (!O(a)) throw Error("React.Children.only expected to receive a single React element child.");
    return a;
  } };
  react_production_min.Component = E;
  react_production_min.Fragment = p;
  react_production_min.Profiler = r;
  react_production_min.PureComponent = G;
  react_production_min.StrictMode = q;
  react_production_min.Suspense = w;
  react_production_min.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED = W2;
  react_production_min.act = X;
  react_production_min.cloneElement = function(a, b, e) {
    if (null === a || void 0 === a) throw Error("React.cloneElement(...): The argument must be a React element, but you passed " + a + ".");
    var d = C({}, a.props), c = a.key, k = a.ref, h = a._owner;
    if (null != b) {
      void 0 !== b.ref && (k = b.ref, h = K.current);
      void 0 !== b.key && (c = "" + b.key);
      if (a.type && a.type.defaultProps) var g = a.type.defaultProps;
      for (f in b) J.call(b, f) && !L.hasOwnProperty(f) && (d[f] = void 0 === b[f] && void 0 !== g ? g[f] : b[f]);
    }
    var f = arguments.length - 2;
    if (1 === f) d.children = e;
    else if (1 < f) {
      g = Array(f);
      for (var m = 0; m < f; m++) g[m] = arguments[m + 2];
      d.children = g;
    }
    return { $$typeof: l, type: a.type, key: c, ref: k, props: d, _owner: h };
  };
  react_production_min.createContext = function(a) {
    a = { $$typeof: u, _currentValue: a, _currentValue2: a, _threadCount: 0, Provider: null, Consumer: null, _defaultValue: null, _globalName: null };
    a.Provider = { $$typeof: t, _context: a };
    return a.Consumer = a;
  };
  react_production_min.createElement = M;
  react_production_min.createFactory = function(a) {
    var b = M.bind(null, a);
    b.type = a;
    return b;
  };
  react_production_min.createRef = function() {
    return { current: null };
  };
  react_production_min.forwardRef = function(a) {
    return { $$typeof: v, render: a };
  };
  react_production_min.isValidElement = O;
  react_production_min.lazy = function(a) {
    return { $$typeof: y, _payload: { _status: -1, _result: a }, _init: T };
  };
  react_production_min.memo = function(a, b) {
    return { $$typeof: x, type: a, compare: void 0 === b ? null : b };
  };
  react_production_min.startTransition = function(a) {
    var b = V.transition;
    V.transition = {};
    try {
      a();
    } finally {
      V.transition = b;
    }
  };
  react_production_min.unstable_act = X;
  react_production_min.useCallback = function(a, b) {
    return U.current.useCallback(a, b);
  };
  react_production_min.useContext = function(a) {
    return U.current.useContext(a);
  };
  react_production_min.useDebugValue = function() {
  };
  react_production_min.useDeferredValue = function(a) {
    return U.current.useDeferredValue(a);
  };
  react_production_min.useEffect = function(a, b) {
    return U.current.useEffect(a, b);
  };
  react_production_min.useId = function() {
    return U.current.useId();
  };
  react_production_min.useImperativeHandle = function(a, b, e) {
    return U.current.useImperativeHandle(a, b, e);
  };
  react_production_min.useInsertionEffect = function(a, b) {
    return U.current.useInsertionEffect(a, b);
  };
  react_production_min.useLayoutEffect = function(a, b) {
    return U.current.useLayoutEffect(a, b);
  };
  react_production_min.useMemo = function(a, b) {
    return U.current.useMemo(a, b);
  };
  react_production_min.useReducer = function(a, b, e) {
    return U.current.useReducer(a, b, e);
  };
  react_production_min.useRef = function(a) {
    return U.current.useRef(a);
  };
  react_production_min.useState = function(a) {
    return U.current.useState(a);
  };
  react_production_min.useSyncExternalStore = function(a, b, e) {
    return U.current.useSyncExternalStore(a, b, e);
  };
  react_production_min.useTransition = function() {
    return U.current.useTransition();
  };
  react_production_min.version = "18.3.1";
  return react_production_min;
}
var hasRequiredReact;
function requireReact() {
  if (hasRequiredReact) return react.exports;
  hasRequiredReact = 1;
  {
    react.exports = requireReact_production_min();
  }
  return react.exports;
}
/**
 * @license React
 * react-jsx-runtime.production.min.js
 *
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
var hasRequiredReactJsxRuntime_production_min;
function requireReactJsxRuntime_production_min() {
  if (hasRequiredReactJsxRuntime_production_min) return reactJsxRuntime_production_min;
  hasRequiredReactJsxRuntime_production_min = 1;
  var f = requireReact(), k = Symbol.for("react.element"), l = Symbol.for("react.fragment"), m = Object.prototype.hasOwnProperty, n = f.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentOwner, p = { key: true, ref: true, __self: true, __source: true };
  function q(c, a, g) {
    var b, d = {}, e = null, h = null;
    void 0 !== g && (e = "" + g);
    void 0 !== a.key && (e = "" + a.key);
    void 0 !== a.ref && (h = a.ref);
    for (b in a) m.call(a, b) && !p.hasOwnProperty(b) && (d[b] = a[b]);
    if (c && c.defaultProps) for (b in a = c.defaultProps, a) void 0 === d[b] && (d[b] = a[b]);
    return { $$typeof: k, type: c, key: e, ref: h, props: d, _owner: n.current };
  }
  reactJsxRuntime_production_min.Fragment = l;
  reactJsxRuntime_production_min.jsx = q;
  reactJsxRuntime_production_min.jsxs = q;
  return reactJsxRuntime_production_min;
}
var hasRequiredJsxRuntime;
function requireJsxRuntime() {
  if (hasRequiredJsxRuntime) return jsxRuntime.exports;
  hasRequiredJsxRuntime = 1;
  {
    jsxRuntime.exports = requireReactJsxRuntime_production_min();
  }
  return jsxRuntime.exports;
}
var jsxRuntimeExports = requireJsxRuntime();
var reactExports = requireReact();
var client = {};
var reactDom = { exports: {} };
var reactDom_production_min = {};
var scheduler = { exports: {} };
var scheduler_production_min = {};
/**
 * @license React
 * scheduler.production.min.js
 *
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
var hasRequiredScheduler_production_min;
function requireScheduler_production_min() {
  if (hasRequiredScheduler_production_min) return scheduler_production_min;
  hasRequiredScheduler_production_min = 1;
  (function(exports) {
    function f(a, b) {
      var c = a.length;
      a.push(b);
      a: for (; 0 < c; ) {
        var d = c - 1 >>> 1, e = a[d];
        if (0 < g(e, b)) a[d] = b, a[c] = e, c = d;
        else break a;
      }
    }
    function h(a) {
      return 0 === a.length ? null : a[0];
    }
    function k(a) {
      if (0 === a.length) return null;
      var b = a[0], c = a.pop();
      if (c !== b) {
        a[0] = c;
        a: for (var d = 0, e = a.length, w = e >>> 1; d < w; ) {
          var m = 2 * (d + 1) - 1, C = a[m], n = m + 1, x = a[n];
          if (0 > g(C, c)) n < e && 0 > g(x, C) ? (a[d] = x, a[n] = c, d = n) : (a[d] = C, a[m] = c, d = m);
          else if (n < e && 0 > g(x, c)) a[d] = x, a[n] = c, d = n;
          else break a;
        }
      }
      return b;
    }
    function g(a, b) {
      var c = a.sortIndex - b.sortIndex;
      return 0 !== c ? c : a.id - b.id;
    }
    if ("object" === typeof performance && "function" === typeof performance.now) {
      var l = performance;
      exports.unstable_now = function() {
        return l.now();
      };
    } else {
      var p = Date, q = p.now();
      exports.unstable_now = function() {
        return p.now() - q;
      };
    }
    var r = [], t = [], u = 1, v = null, y = 3, z = false, A = false, B = false, D = "function" === typeof setTimeout ? setTimeout : null, E = "function" === typeof clearTimeout ? clearTimeout : null, F = "undefined" !== typeof setImmediate ? setImmediate : null;
    "undefined" !== typeof navigator && void 0 !== navigator.scheduling && void 0 !== navigator.scheduling.isInputPending && navigator.scheduling.isInputPending.bind(navigator.scheduling);
    function G(a) {
      for (var b = h(t); null !== b; ) {
        if (null === b.callback) k(t);
        else if (b.startTime <= a) k(t), b.sortIndex = b.expirationTime, f(r, b);
        else break;
        b = h(t);
      }
    }
    function H(a) {
      B = false;
      G(a);
      if (!A) if (null !== h(r)) A = true, I(J);
      else {
        var b = h(t);
        null !== b && K(H, b.startTime - a);
      }
    }
    function J(a, b) {
      A = false;
      B && (B = false, E(L), L = -1);
      z = true;
      var c = y;
      try {
        G(b);
        for (v = h(r); null !== v && (!(v.expirationTime > b) || a && !M()); ) {
          var d = v.callback;
          if ("function" === typeof d) {
            v.callback = null;
            y = v.priorityLevel;
            var e = d(v.expirationTime <= b);
            b = exports.unstable_now();
            "function" === typeof e ? v.callback = e : v === h(r) && k(r);
            G(b);
          } else k(r);
          v = h(r);
        }
        if (null !== v) var w = true;
        else {
          var m = h(t);
          null !== m && K(H, m.startTime - b);
          w = false;
        }
        return w;
      } finally {
        v = null, y = c, z = false;
      }
    }
    var N = false, O = null, L = -1, P = 5, Q = -1;
    function M() {
      return exports.unstable_now() - Q < P ? false : true;
    }
    function R() {
      if (null !== O) {
        var a = exports.unstable_now();
        Q = a;
        var b = true;
        try {
          b = O(true, a);
        } finally {
          b ? S() : (N = false, O = null);
        }
      } else N = false;
    }
    var S;
    if ("function" === typeof F) S = function() {
      F(R);
    };
    else if ("undefined" !== typeof MessageChannel) {
      var T = new MessageChannel(), U = T.port2;
      T.port1.onmessage = R;
      S = function() {
        U.postMessage(null);
      };
    } else S = function() {
      D(R, 0);
    };
    function I(a) {
      O = a;
      N || (N = true, S());
    }
    function K(a, b) {
      L = D(function() {
        a(exports.unstable_now());
      }, b);
    }
    exports.unstable_IdlePriority = 5;
    exports.unstable_ImmediatePriority = 1;
    exports.unstable_LowPriority = 4;
    exports.unstable_NormalPriority = 3;
    exports.unstable_Profiling = null;
    exports.unstable_UserBlockingPriority = 2;
    exports.unstable_cancelCallback = function(a) {
      a.callback = null;
    };
    exports.unstable_continueExecution = function() {
      A || z || (A = true, I(J));
    };
    exports.unstable_forceFrameRate = function(a) {
      0 > a || 125 < a ? console.error("forceFrameRate takes a positive int between 0 and 125, forcing frame rates higher than 125 fps is not supported") : P = 0 < a ? Math.floor(1e3 / a) : 5;
    };
    exports.unstable_getCurrentPriorityLevel = function() {
      return y;
    };
    exports.unstable_getFirstCallbackNode = function() {
      return h(r);
    };
    exports.unstable_next = function(a) {
      switch (y) {
        case 1:
        case 2:
        case 3:
          var b = 3;
          break;
        default:
          b = y;
      }
      var c = y;
      y = b;
      try {
        return a();
      } finally {
        y = c;
      }
    };
    exports.unstable_pauseExecution = function() {
    };
    exports.unstable_requestPaint = function() {
    };
    exports.unstable_runWithPriority = function(a, b) {
      switch (a) {
        case 1:
        case 2:
        case 3:
        case 4:
        case 5:
          break;
        default:
          a = 3;
      }
      var c = y;
      y = a;
      try {
        return b();
      } finally {
        y = c;
      }
    };
    exports.unstable_scheduleCallback = function(a, b, c) {
      var d = exports.unstable_now();
      "object" === typeof c && null !== c ? (c = c.delay, c = "number" === typeof c && 0 < c ? d + c : d) : c = d;
      switch (a) {
        case 1:
          var e = -1;
          break;
        case 2:
          e = 250;
          break;
        case 5:
          e = 1073741823;
          break;
        case 4:
          e = 1e4;
          break;
        default:
          e = 5e3;
      }
      e = c + e;
      a = { id: u++, callback: b, priorityLevel: a, startTime: c, expirationTime: e, sortIndex: -1 };
      c > d ? (a.sortIndex = c, f(t, a), null === h(r) && a === h(t) && (B ? (E(L), L = -1) : B = true, K(H, c - d))) : (a.sortIndex = e, f(r, a), A || z || (A = true, I(J)));
      return a;
    };
    exports.unstable_shouldYield = M;
    exports.unstable_wrapCallback = function(a) {
      var b = y;
      return function() {
        var c = y;
        y = b;
        try {
          return a.apply(this, arguments);
        } finally {
          y = c;
        }
      };
    };
  })(scheduler_production_min);
  return scheduler_production_min;
}
var hasRequiredScheduler;
function requireScheduler() {
  if (hasRequiredScheduler) return scheduler.exports;
  hasRequiredScheduler = 1;
  {
    scheduler.exports = requireScheduler_production_min();
  }
  return scheduler.exports;
}
/**
 * @license React
 * react-dom.production.min.js
 *
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
var hasRequiredReactDom_production_min;
function requireReactDom_production_min() {
  if (hasRequiredReactDom_production_min) return reactDom_production_min;
  hasRequiredReactDom_production_min = 1;
  var aa = requireReact(), ca = requireScheduler();
  function p(a) {
    for (var b = "https://reactjs.org/docs/error-decoder.html?invariant=" + a, c = 1; c < arguments.length; c++) b += "&args[]=" + encodeURIComponent(arguments[c]);
    return "Minified React error #" + a + "; visit " + b + " for the full message or use the non-minified dev environment for full errors and additional helpful warnings.";
  }
  var da = /* @__PURE__ */ new Set(), ea = {};
  function fa(a, b) {
    ha(a, b);
    ha(a + "Capture", b);
  }
  function ha(a, b) {
    ea[a] = b;
    for (a = 0; a < b.length; a++) da.add(b[a]);
  }
  var ia = !("undefined" === typeof window || "undefined" === typeof window.document || "undefined" === typeof window.document.createElement), ja = Object.prototype.hasOwnProperty, ka = /^[:A-Z_a-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD][:A-Z_a-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\-.0-9\u00B7\u0300-\u036F\u203F-\u2040]*$/, la = {}, ma = {};
  function oa(a) {
    if (ja.call(ma, a)) return true;
    if (ja.call(la, a)) return false;
    if (ka.test(a)) return ma[a] = true;
    la[a] = true;
    return false;
  }
  function pa(a, b, c, d) {
    if (null !== c && 0 === c.type) return false;
    switch (typeof b) {
      case "function":
      case "symbol":
        return true;
      case "boolean":
        if (d) return false;
        if (null !== c) return !c.acceptsBooleans;
        a = a.toLowerCase().slice(0, 5);
        return "data-" !== a && "aria-" !== a;
      default:
        return false;
    }
  }
  function qa(a, b, c, d) {
    if (null === b || "undefined" === typeof b || pa(a, b, c, d)) return true;
    if (d) return false;
    if (null !== c) switch (c.type) {
      case 3:
        return !b;
      case 4:
        return false === b;
      case 5:
        return isNaN(b);
      case 6:
        return isNaN(b) || 1 > b;
    }
    return false;
  }
  function v(a, b, c, d, e, f, g) {
    this.acceptsBooleans = 2 === b || 3 === b || 4 === b;
    this.attributeName = d;
    this.attributeNamespace = e;
    this.mustUseProperty = c;
    this.propertyName = a;
    this.type = b;
    this.sanitizeURL = f;
    this.removeEmptyString = g;
  }
  var z = {};
  "children dangerouslySetInnerHTML defaultValue defaultChecked innerHTML suppressContentEditableWarning suppressHydrationWarning style".split(" ").forEach(function(a) {
    z[a] = new v(a, 0, false, a, null, false, false);
  });
  [["acceptCharset", "accept-charset"], ["className", "class"], ["htmlFor", "for"], ["httpEquiv", "http-equiv"]].forEach(function(a) {
    var b = a[0];
    z[b] = new v(b, 1, false, a[1], null, false, false);
  });
  ["contentEditable", "draggable", "spellCheck", "value"].forEach(function(a) {
    z[a] = new v(a, 2, false, a.toLowerCase(), null, false, false);
  });
  ["autoReverse", "externalResourcesRequired", "focusable", "preserveAlpha"].forEach(function(a) {
    z[a] = new v(a, 2, false, a, null, false, false);
  });
  "allowFullScreen async autoFocus autoPlay controls default defer disabled disablePictureInPicture disableRemotePlayback formNoValidate hidden loop noModule noValidate open playsInline readOnly required reversed scoped seamless itemScope".split(" ").forEach(function(a) {
    z[a] = new v(a, 3, false, a.toLowerCase(), null, false, false);
  });
  ["checked", "multiple", "muted", "selected"].forEach(function(a) {
    z[a] = new v(a, 3, true, a, null, false, false);
  });
  ["capture", "download"].forEach(function(a) {
    z[a] = new v(a, 4, false, a, null, false, false);
  });
  ["cols", "rows", "size", "span"].forEach(function(a) {
    z[a] = new v(a, 6, false, a, null, false, false);
  });
  ["rowSpan", "start"].forEach(function(a) {
    z[a] = new v(a, 5, false, a.toLowerCase(), null, false, false);
  });
  var ra = /[\-:]([a-z])/g;
  function sa(a) {
    return a[1].toUpperCase();
  }
  "accent-height alignment-baseline arabic-form baseline-shift cap-height clip-path clip-rule color-interpolation color-interpolation-filters color-profile color-rendering dominant-baseline enable-background fill-opacity fill-rule flood-color flood-opacity font-family font-size font-size-adjust font-stretch font-style font-variant font-weight glyph-name glyph-orientation-horizontal glyph-orientation-vertical horiz-adv-x horiz-origin-x image-rendering letter-spacing lighting-color marker-end marker-mid marker-start overline-position overline-thickness paint-order panose-1 pointer-events rendering-intent shape-rendering stop-color stop-opacity strikethrough-position strikethrough-thickness stroke-dasharray stroke-dashoffset stroke-linecap stroke-linejoin stroke-miterlimit stroke-opacity stroke-width text-anchor text-decoration text-rendering underline-position underline-thickness unicode-bidi unicode-range units-per-em v-alphabetic v-hanging v-ideographic v-mathematical vector-effect vert-adv-y vert-origin-x vert-origin-y word-spacing writing-mode xmlns:xlink x-height".split(" ").forEach(function(a) {
    var b = a.replace(
      ra,
      sa
    );
    z[b] = new v(b, 1, false, a, null, false, false);
  });
  "xlink:actuate xlink:arcrole xlink:role xlink:show xlink:title xlink:type".split(" ").forEach(function(a) {
    var b = a.replace(ra, sa);
    z[b] = new v(b, 1, false, a, "http://www.w3.org/1999/xlink", false, false);
  });
  ["xml:base", "xml:lang", "xml:space"].forEach(function(a) {
    var b = a.replace(ra, sa);
    z[b] = new v(b, 1, false, a, "http://www.w3.org/XML/1998/namespace", false, false);
  });
  ["tabIndex", "crossOrigin"].forEach(function(a) {
    z[a] = new v(a, 1, false, a.toLowerCase(), null, false, false);
  });
  z.xlinkHref = new v("xlinkHref", 1, false, "xlink:href", "http://www.w3.org/1999/xlink", true, false);
  ["src", "href", "action", "formAction"].forEach(function(a) {
    z[a] = new v(a, 1, false, a.toLowerCase(), null, true, true);
  });
  function ta(a, b, c, d) {
    var e = z.hasOwnProperty(b) ? z[b] : null;
    if (null !== e ? 0 !== e.type : d || !(2 < b.length) || "o" !== b[0] && "O" !== b[0] || "n" !== b[1] && "N" !== b[1]) qa(b, c, e, d) && (c = null), d || null === e ? oa(b) && (null === c ? a.removeAttribute(b) : a.setAttribute(b, "" + c)) : e.mustUseProperty ? a[e.propertyName] = null === c ? 3 === e.type ? false : "" : c : (b = e.attributeName, d = e.attributeNamespace, null === c ? a.removeAttribute(b) : (e = e.type, c = 3 === e || 4 === e && true === c ? "" : "" + c, d ? a.setAttributeNS(d, b, c) : a.setAttribute(b, c)));
  }
  var ua = aa.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED, va = Symbol.for("react.element"), wa = Symbol.for("react.portal"), ya = Symbol.for("react.fragment"), za = Symbol.for("react.strict_mode"), Aa = Symbol.for("react.profiler"), Ba = Symbol.for("react.provider"), Ca = Symbol.for("react.context"), Da = Symbol.for("react.forward_ref"), Ea = Symbol.for("react.suspense"), Fa = Symbol.for("react.suspense_list"), Ga = Symbol.for("react.memo"), Ha = Symbol.for("react.lazy");
  var Ia = Symbol.for("react.offscreen");
  var Ja = Symbol.iterator;
  function Ka(a) {
    if (null === a || "object" !== typeof a) return null;
    a = Ja && a[Ja] || a["@@iterator"];
    return "function" === typeof a ? a : null;
  }
  var A = Object.assign, La;
  function Ma(a) {
    if (void 0 === La) try {
      throw Error();
    } catch (c) {
      var b = c.stack.trim().match(/\n( *(at )?)/);
      La = b && b[1] || "";
    }
    return "\n" + La + a;
  }
  var Na = false;
  function Oa(a, b) {
    if (!a || Na) return "";
    Na = true;
    var c = Error.prepareStackTrace;
    Error.prepareStackTrace = void 0;
    try {
      if (b) if (b = function() {
        throw Error();
      }, Object.defineProperty(b.prototype, "props", { set: function() {
        throw Error();
      } }), "object" === typeof Reflect && Reflect.construct) {
        try {
          Reflect.construct(b, []);
        } catch (l) {
          var d = l;
        }
        Reflect.construct(a, [], b);
      } else {
        try {
          b.call();
        } catch (l) {
          d = l;
        }
        a.call(b.prototype);
      }
      else {
        try {
          throw Error();
        } catch (l) {
          d = l;
        }
        a();
      }
    } catch (l) {
      if (l && d && "string" === typeof l.stack) {
        for (var e = l.stack.split("\n"), f = d.stack.split("\n"), g = e.length - 1, h = f.length - 1; 1 <= g && 0 <= h && e[g] !== f[h]; ) h--;
        for (; 1 <= g && 0 <= h; g--, h--) if (e[g] !== f[h]) {
          if (1 !== g || 1 !== h) {
            do
              if (g--, h--, 0 > h || e[g] !== f[h]) {
                var k = "\n" + e[g].replace(" at new ", " at ");
                a.displayName && k.includes("<anonymous>") && (k = k.replace("<anonymous>", a.displayName));
                return k;
              }
            while (1 <= g && 0 <= h);
          }
          break;
        }
      }
    } finally {
      Na = false, Error.prepareStackTrace = c;
    }
    return (a = a ? a.displayName || a.name : "") ? Ma(a) : "";
  }
  function Pa(a) {
    switch (a.tag) {
      case 5:
        return Ma(a.type);
      case 16:
        return Ma("Lazy");
      case 13:
        return Ma("Suspense");
      case 19:
        return Ma("SuspenseList");
      case 0:
      case 2:
      case 15:
        return a = Oa(a.type, false), a;
      case 11:
        return a = Oa(a.type.render, false), a;
      case 1:
        return a = Oa(a.type, true), a;
      default:
        return "";
    }
  }
  function Qa(a) {
    if (null == a) return null;
    if ("function" === typeof a) return a.displayName || a.name || null;
    if ("string" === typeof a) return a;
    switch (a) {
      case ya:
        return "Fragment";
      case wa:
        return "Portal";
      case Aa:
        return "Profiler";
      case za:
        return "StrictMode";
      case Ea:
        return "Suspense";
      case Fa:
        return "SuspenseList";
    }
    if ("object" === typeof a) switch (a.$$typeof) {
      case Ca:
        return (a.displayName || "Context") + ".Consumer";
      case Ba:
        return (a._context.displayName || "Context") + ".Provider";
      case Da:
        var b = a.render;
        a = a.displayName;
        a || (a = b.displayName || b.name || "", a = "" !== a ? "ForwardRef(" + a + ")" : "ForwardRef");
        return a;
      case Ga:
        return b = a.displayName || null, null !== b ? b : Qa(a.type) || "Memo";
      case Ha:
        b = a._payload;
        a = a._init;
        try {
          return Qa(a(b));
        } catch (c) {
        }
    }
    return null;
  }
  function Ra(a) {
    var b = a.type;
    switch (a.tag) {
      case 24:
        return "Cache";
      case 9:
        return (b.displayName || "Context") + ".Consumer";
      case 10:
        return (b._context.displayName || "Context") + ".Provider";
      case 18:
        return "DehydratedFragment";
      case 11:
        return a = b.render, a = a.displayName || a.name || "", b.displayName || ("" !== a ? "ForwardRef(" + a + ")" : "ForwardRef");
      case 7:
        return "Fragment";
      case 5:
        return b;
      case 4:
        return "Portal";
      case 3:
        return "Root";
      case 6:
        return "Text";
      case 16:
        return Qa(b);
      case 8:
        return b === za ? "StrictMode" : "Mode";
      case 22:
        return "Offscreen";
      case 12:
        return "Profiler";
      case 21:
        return "Scope";
      case 13:
        return "Suspense";
      case 19:
        return "SuspenseList";
      case 25:
        return "TracingMarker";
      case 1:
      case 0:
      case 17:
      case 2:
      case 14:
      case 15:
        if ("function" === typeof b) return b.displayName || b.name || null;
        if ("string" === typeof b) return b;
    }
    return null;
  }
  function Sa(a) {
    switch (typeof a) {
      case "boolean":
      case "number":
      case "string":
      case "undefined":
        return a;
      case "object":
        return a;
      default:
        return "";
    }
  }
  function Ta(a) {
    var b = a.type;
    return (a = a.nodeName) && "input" === a.toLowerCase() && ("checkbox" === b || "radio" === b);
  }
  function Ua(a) {
    var b = Ta(a) ? "checked" : "value", c = Object.getOwnPropertyDescriptor(a.constructor.prototype, b), d = "" + a[b];
    if (!a.hasOwnProperty(b) && "undefined" !== typeof c && "function" === typeof c.get && "function" === typeof c.set) {
      var e = c.get, f = c.set;
      Object.defineProperty(a, b, { configurable: true, get: function() {
        return e.call(this);
      }, set: function(a2) {
        d = "" + a2;
        f.call(this, a2);
      } });
      Object.defineProperty(a, b, { enumerable: c.enumerable });
      return { getValue: function() {
        return d;
      }, setValue: function(a2) {
        d = "" + a2;
      }, stopTracking: function() {
        a._valueTracker = null;
        delete a[b];
      } };
    }
  }
  function Va(a) {
    a._valueTracker || (a._valueTracker = Ua(a));
  }
  function Wa(a) {
    if (!a) return false;
    var b = a._valueTracker;
    if (!b) return true;
    var c = b.getValue();
    var d = "";
    a && (d = Ta(a) ? a.checked ? "true" : "false" : a.value);
    a = d;
    return a !== c ? (b.setValue(a), true) : false;
  }
  function Xa(a) {
    a = a || ("undefined" !== typeof document ? document : void 0);
    if ("undefined" === typeof a) return null;
    try {
      return a.activeElement || a.body;
    } catch (b) {
      return a.body;
    }
  }
  function Ya(a, b) {
    var c = b.checked;
    return A({}, b, { defaultChecked: void 0, defaultValue: void 0, value: void 0, checked: null != c ? c : a._wrapperState.initialChecked });
  }
  function Za(a, b) {
    var c = null == b.defaultValue ? "" : b.defaultValue, d = null != b.checked ? b.checked : b.defaultChecked;
    c = Sa(null != b.value ? b.value : c);
    a._wrapperState = { initialChecked: d, initialValue: c, controlled: "checkbox" === b.type || "radio" === b.type ? null != b.checked : null != b.value };
  }
  function ab(a, b) {
    b = b.checked;
    null != b && ta(a, "checked", b, false);
  }
  function bb(a, b) {
    ab(a, b);
    var c = Sa(b.value), d = b.type;
    if (null != c) if ("number" === d) {
      if (0 === c && "" === a.value || a.value != c) a.value = "" + c;
    } else a.value !== "" + c && (a.value = "" + c);
    else if ("submit" === d || "reset" === d) {
      a.removeAttribute("value");
      return;
    }
    b.hasOwnProperty("value") ? cb(a, b.type, c) : b.hasOwnProperty("defaultValue") && cb(a, b.type, Sa(b.defaultValue));
    null == b.checked && null != b.defaultChecked && (a.defaultChecked = !!b.defaultChecked);
  }
  function db(a, b, c) {
    if (b.hasOwnProperty("value") || b.hasOwnProperty("defaultValue")) {
      var d = b.type;
      if (!("submit" !== d && "reset" !== d || void 0 !== b.value && null !== b.value)) return;
      b = "" + a._wrapperState.initialValue;
      c || b === a.value || (a.value = b);
      a.defaultValue = b;
    }
    c = a.name;
    "" !== c && (a.name = "");
    a.defaultChecked = !!a._wrapperState.initialChecked;
    "" !== c && (a.name = c);
  }
  function cb(a, b, c) {
    if ("number" !== b || Xa(a.ownerDocument) !== a) null == c ? a.defaultValue = "" + a._wrapperState.initialValue : a.defaultValue !== "" + c && (a.defaultValue = "" + c);
  }
  var eb = Array.isArray;
  function fb(a, b, c, d) {
    a = a.options;
    if (b) {
      b = {};
      for (var e = 0; e < c.length; e++) b["$" + c[e]] = true;
      for (c = 0; c < a.length; c++) e = b.hasOwnProperty("$" + a[c].value), a[c].selected !== e && (a[c].selected = e), e && d && (a[c].defaultSelected = true);
    } else {
      c = "" + Sa(c);
      b = null;
      for (e = 0; e < a.length; e++) {
        if (a[e].value === c) {
          a[e].selected = true;
          d && (a[e].defaultSelected = true);
          return;
        }
        null !== b || a[e].disabled || (b = a[e]);
      }
      null !== b && (b.selected = true);
    }
  }
  function gb(a, b) {
    if (null != b.dangerouslySetInnerHTML) throw Error(p(91));
    return A({}, b, { value: void 0, defaultValue: void 0, children: "" + a._wrapperState.initialValue });
  }
  function hb(a, b) {
    var c = b.value;
    if (null == c) {
      c = b.children;
      b = b.defaultValue;
      if (null != c) {
        if (null != b) throw Error(p(92));
        if (eb(c)) {
          if (1 < c.length) throw Error(p(93));
          c = c[0];
        }
        b = c;
      }
      null == b && (b = "");
      c = b;
    }
    a._wrapperState = { initialValue: Sa(c) };
  }
  function ib(a, b) {
    var c = Sa(b.value), d = Sa(b.defaultValue);
    null != c && (c = "" + c, c !== a.value && (a.value = c), null == b.defaultValue && a.defaultValue !== c && (a.defaultValue = c));
    null != d && (a.defaultValue = "" + d);
  }
  function jb(a) {
    var b = a.textContent;
    b === a._wrapperState.initialValue && "" !== b && null !== b && (a.value = b);
  }
  function kb(a) {
    switch (a) {
      case "svg":
        return "http://www.w3.org/2000/svg";
      case "math":
        return "http://www.w3.org/1998/Math/MathML";
      default:
        return "http://www.w3.org/1999/xhtml";
    }
  }
  function lb(a, b) {
    return null == a || "http://www.w3.org/1999/xhtml" === a ? kb(b) : "http://www.w3.org/2000/svg" === a && "foreignObject" === b ? "http://www.w3.org/1999/xhtml" : a;
  }
  var mb, nb = (function(a) {
    return "undefined" !== typeof MSApp && MSApp.execUnsafeLocalFunction ? function(b, c, d, e) {
      MSApp.execUnsafeLocalFunction(function() {
        return a(b, c, d, e);
      });
    } : a;
  })(function(a, b) {
    if ("http://www.w3.org/2000/svg" !== a.namespaceURI || "innerHTML" in a) a.innerHTML = b;
    else {
      mb = mb || document.createElement("div");
      mb.innerHTML = "<svg>" + b.valueOf().toString() + "</svg>";
      for (b = mb.firstChild; a.firstChild; ) a.removeChild(a.firstChild);
      for (; b.firstChild; ) a.appendChild(b.firstChild);
    }
  });
  function ob(a, b) {
    if (b) {
      var c = a.firstChild;
      if (c && c === a.lastChild && 3 === c.nodeType) {
        c.nodeValue = b;
        return;
      }
    }
    a.textContent = b;
  }
  var pb = {
    animationIterationCount: true,
    aspectRatio: true,
    borderImageOutset: true,
    borderImageSlice: true,
    borderImageWidth: true,
    boxFlex: true,
    boxFlexGroup: true,
    boxOrdinalGroup: true,
    columnCount: true,
    columns: true,
    flex: true,
    flexGrow: true,
    flexPositive: true,
    flexShrink: true,
    flexNegative: true,
    flexOrder: true,
    gridArea: true,
    gridRow: true,
    gridRowEnd: true,
    gridRowSpan: true,
    gridRowStart: true,
    gridColumn: true,
    gridColumnEnd: true,
    gridColumnSpan: true,
    gridColumnStart: true,
    fontWeight: true,
    lineClamp: true,
    lineHeight: true,
    opacity: true,
    order: true,
    orphans: true,
    tabSize: true,
    widows: true,
    zIndex: true,
    zoom: true,
    fillOpacity: true,
    floodOpacity: true,
    stopOpacity: true,
    strokeDasharray: true,
    strokeDashoffset: true,
    strokeMiterlimit: true,
    strokeOpacity: true,
    strokeWidth: true
  }, qb = ["Webkit", "ms", "Moz", "O"];
  Object.keys(pb).forEach(function(a) {
    qb.forEach(function(b) {
      b = b + a.charAt(0).toUpperCase() + a.substring(1);
      pb[b] = pb[a];
    });
  });
  function rb(a, b, c) {
    return null == b || "boolean" === typeof b || "" === b ? "" : c || "number" !== typeof b || 0 === b || pb.hasOwnProperty(a) && pb[a] ? ("" + b).trim() : b + "px";
  }
  function sb(a, b) {
    a = a.style;
    for (var c in b) if (b.hasOwnProperty(c)) {
      var d = 0 === c.indexOf("--"), e = rb(c, b[c], d);
      "float" === c && (c = "cssFloat");
      d ? a.setProperty(c, e) : a[c] = e;
    }
  }
  var tb = A({ menuitem: true }, { area: true, base: true, br: true, col: true, embed: true, hr: true, img: true, input: true, keygen: true, link: true, meta: true, param: true, source: true, track: true, wbr: true });
  function ub(a, b) {
    if (b) {
      if (tb[a] && (null != b.children || null != b.dangerouslySetInnerHTML)) throw Error(p(137, a));
      if (null != b.dangerouslySetInnerHTML) {
        if (null != b.children) throw Error(p(60));
        if ("object" !== typeof b.dangerouslySetInnerHTML || !("__html" in b.dangerouslySetInnerHTML)) throw Error(p(61));
      }
      if (null != b.style && "object" !== typeof b.style) throw Error(p(62));
    }
  }
  function vb(a, b) {
    if (-1 === a.indexOf("-")) return "string" === typeof b.is;
    switch (a) {
      case "annotation-xml":
      case "color-profile":
      case "font-face":
      case "font-face-src":
      case "font-face-uri":
      case "font-face-format":
      case "font-face-name":
      case "missing-glyph":
        return false;
      default:
        return true;
    }
  }
  var wb = null;
  function xb(a) {
    a = a.target || a.srcElement || window;
    a.correspondingUseElement && (a = a.correspondingUseElement);
    return 3 === a.nodeType ? a.parentNode : a;
  }
  var yb = null, zb = null, Ab = null;
  function Bb(a) {
    if (a = Cb(a)) {
      if ("function" !== typeof yb) throw Error(p(280));
      var b = a.stateNode;
      b && (b = Db(b), yb(a.stateNode, a.type, b));
    }
  }
  function Eb(a) {
    zb ? Ab ? Ab.push(a) : Ab = [a] : zb = a;
  }
  function Fb() {
    if (zb) {
      var a = zb, b = Ab;
      Ab = zb = null;
      Bb(a);
      if (b) for (a = 0; a < b.length; a++) Bb(b[a]);
    }
  }
  function Gb(a, b) {
    return a(b);
  }
  function Hb() {
  }
  var Ib = false;
  function Jb(a, b, c) {
    if (Ib) return a(b, c);
    Ib = true;
    try {
      return Gb(a, b, c);
    } finally {
      if (Ib = false, null !== zb || null !== Ab) Hb(), Fb();
    }
  }
  function Kb(a, b) {
    var c = a.stateNode;
    if (null === c) return null;
    var d = Db(c);
    if (null === d) return null;
    c = d[b];
    a: switch (b) {
      case "onClick":
      case "onClickCapture":
      case "onDoubleClick":
      case "onDoubleClickCapture":
      case "onMouseDown":
      case "onMouseDownCapture":
      case "onMouseMove":
      case "onMouseMoveCapture":
      case "onMouseUp":
      case "onMouseUpCapture":
      case "onMouseEnter":
        (d = !d.disabled) || (a = a.type, d = !("button" === a || "input" === a || "select" === a || "textarea" === a));
        a = !d;
        break a;
      default:
        a = false;
    }
    if (a) return null;
    if (c && "function" !== typeof c) throw Error(p(231, b, typeof c));
    return c;
  }
  var Lb = false;
  if (ia) try {
    var Mb = {};
    Object.defineProperty(Mb, "passive", { get: function() {
      Lb = true;
    } });
    window.addEventListener("test", Mb, Mb);
    window.removeEventListener("test", Mb, Mb);
  } catch (a) {
    Lb = false;
  }
  function Nb(a, b, c, d, e, f, g, h, k) {
    var l = Array.prototype.slice.call(arguments, 3);
    try {
      b.apply(c, l);
    } catch (m) {
      this.onError(m);
    }
  }
  var Ob = false, Pb = null, Qb = false, Rb = null, Sb = { onError: function(a) {
    Ob = true;
    Pb = a;
  } };
  function Tb(a, b, c, d, e, f, g, h, k) {
    Ob = false;
    Pb = null;
    Nb.apply(Sb, arguments);
  }
  function Ub(a, b, c, d, e, f, g, h, k) {
    Tb.apply(this, arguments);
    if (Ob) {
      if (Ob) {
        var l = Pb;
        Ob = false;
        Pb = null;
      } else throw Error(p(198));
      Qb || (Qb = true, Rb = l);
    }
  }
  function Vb(a) {
    var b = a, c = a;
    if (a.alternate) for (; b.return; ) b = b.return;
    else {
      a = b;
      do
        b = a, 0 !== (b.flags & 4098) && (c = b.return), a = b.return;
      while (a);
    }
    return 3 === b.tag ? c : null;
  }
  function Wb(a) {
    if (13 === a.tag) {
      var b = a.memoizedState;
      null === b && (a = a.alternate, null !== a && (b = a.memoizedState));
      if (null !== b) return b.dehydrated;
    }
    return null;
  }
  function Xb(a) {
    if (Vb(a) !== a) throw Error(p(188));
  }
  function Yb(a) {
    var b = a.alternate;
    if (!b) {
      b = Vb(a);
      if (null === b) throw Error(p(188));
      return b !== a ? null : a;
    }
    for (var c = a, d = b; ; ) {
      var e = c.return;
      if (null === e) break;
      var f = e.alternate;
      if (null === f) {
        d = e.return;
        if (null !== d) {
          c = d;
          continue;
        }
        break;
      }
      if (e.child === f.child) {
        for (f = e.child; f; ) {
          if (f === c) return Xb(e), a;
          if (f === d) return Xb(e), b;
          f = f.sibling;
        }
        throw Error(p(188));
      }
      if (c.return !== d.return) c = e, d = f;
      else {
        for (var g = false, h = e.child; h; ) {
          if (h === c) {
            g = true;
            c = e;
            d = f;
            break;
          }
          if (h === d) {
            g = true;
            d = e;
            c = f;
            break;
          }
          h = h.sibling;
        }
        if (!g) {
          for (h = f.child; h; ) {
            if (h === c) {
              g = true;
              c = f;
              d = e;
              break;
            }
            if (h === d) {
              g = true;
              d = f;
              c = e;
              break;
            }
            h = h.sibling;
          }
          if (!g) throw Error(p(189));
        }
      }
      if (c.alternate !== d) throw Error(p(190));
    }
    if (3 !== c.tag) throw Error(p(188));
    return c.stateNode.current === c ? a : b;
  }
  function Zb(a) {
    a = Yb(a);
    return null !== a ? $b(a) : null;
  }
  function $b(a) {
    if (5 === a.tag || 6 === a.tag) return a;
    for (a = a.child; null !== a; ) {
      var b = $b(a);
      if (null !== b) return b;
      a = a.sibling;
    }
    return null;
  }
  var ac = ca.unstable_scheduleCallback, bc = ca.unstable_cancelCallback, cc = ca.unstable_shouldYield, dc = ca.unstable_requestPaint, B = ca.unstable_now, ec = ca.unstable_getCurrentPriorityLevel, fc = ca.unstable_ImmediatePriority, gc = ca.unstable_UserBlockingPriority, hc = ca.unstable_NormalPriority, ic = ca.unstable_LowPriority, jc = ca.unstable_IdlePriority, kc = null, lc = null;
  function mc(a) {
    if (lc && "function" === typeof lc.onCommitFiberRoot) try {
      lc.onCommitFiberRoot(kc, a, void 0, 128 === (a.current.flags & 128));
    } catch (b) {
    }
  }
  var oc = Math.clz32 ? Math.clz32 : nc, pc = Math.log, qc = Math.LN2;
  function nc(a) {
    a >>>= 0;
    return 0 === a ? 32 : 31 - (pc(a) / qc | 0) | 0;
  }
  var rc = 64, sc = 4194304;
  function tc(a) {
    switch (a & -a) {
      case 1:
        return 1;
      case 2:
        return 2;
      case 4:
        return 4;
      case 8:
        return 8;
      case 16:
        return 16;
      case 32:
        return 32;
      case 64:
      case 128:
      case 256:
      case 512:
      case 1024:
      case 2048:
      case 4096:
      case 8192:
      case 16384:
      case 32768:
      case 65536:
      case 131072:
      case 262144:
      case 524288:
      case 1048576:
      case 2097152:
        return a & 4194240;
      case 4194304:
      case 8388608:
      case 16777216:
      case 33554432:
      case 67108864:
        return a & 130023424;
      case 134217728:
        return 134217728;
      case 268435456:
        return 268435456;
      case 536870912:
        return 536870912;
      case 1073741824:
        return 1073741824;
      default:
        return a;
    }
  }
  function uc(a, b) {
    var c = a.pendingLanes;
    if (0 === c) return 0;
    var d = 0, e = a.suspendedLanes, f = a.pingedLanes, g = c & 268435455;
    if (0 !== g) {
      var h = g & ~e;
      0 !== h ? d = tc(h) : (f &= g, 0 !== f && (d = tc(f)));
    } else g = c & ~e, 0 !== g ? d = tc(g) : 0 !== f && (d = tc(f));
    if (0 === d) return 0;
    if (0 !== b && b !== d && 0 === (b & e) && (e = d & -d, f = b & -b, e >= f || 16 === e && 0 !== (f & 4194240))) return b;
    0 !== (d & 4) && (d |= c & 16);
    b = a.entangledLanes;
    if (0 !== b) for (a = a.entanglements, b &= d; 0 < b; ) c = 31 - oc(b), e = 1 << c, d |= a[c], b &= ~e;
    return d;
  }
  function vc(a, b) {
    switch (a) {
      case 1:
      case 2:
      case 4:
        return b + 250;
      case 8:
      case 16:
      case 32:
      case 64:
      case 128:
      case 256:
      case 512:
      case 1024:
      case 2048:
      case 4096:
      case 8192:
      case 16384:
      case 32768:
      case 65536:
      case 131072:
      case 262144:
      case 524288:
      case 1048576:
      case 2097152:
        return b + 5e3;
      case 4194304:
      case 8388608:
      case 16777216:
      case 33554432:
      case 67108864:
        return -1;
      case 134217728:
      case 268435456:
      case 536870912:
      case 1073741824:
        return -1;
      default:
        return -1;
    }
  }
  function wc(a, b) {
    for (var c = a.suspendedLanes, d = a.pingedLanes, e = a.expirationTimes, f = a.pendingLanes; 0 < f; ) {
      var g = 31 - oc(f), h = 1 << g, k = e[g];
      if (-1 === k) {
        if (0 === (h & c) || 0 !== (h & d)) e[g] = vc(h, b);
      } else k <= b && (a.expiredLanes |= h);
      f &= ~h;
    }
  }
  function xc(a) {
    a = a.pendingLanes & -1073741825;
    return 0 !== a ? a : a & 1073741824 ? 1073741824 : 0;
  }
  function yc() {
    var a = rc;
    rc <<= 1;
    0 === (rc & 4194240) && (rc = 64);
    return a;
  }
  function zc(a) {
    for (var b = [], c = 0; 31 > c; c++) b.push(a);
    return b;
  }
  function Ac(a, b, c) {
    a.pendingLanes |= b;
    536870912 !== b && (a.suspendedLanes = 0, a.pingedLanes = 0);
    a = a.eventTimes;
    b = 31 - oc(b);
    a[b] = c;
  }
  function Bc(a, b) {
    var c = a.pendingLanes & ~b;
    a.pendingLanes = b;
    a.suspendedLanes = 0;
    a.pingedLanes = 0;
    a.expiredLanes &= b;
    a.mutableReadLanes &= b;
    a.entangledLanes &= b;
    b = a.entanglements;
    var d = a.eventTimes;
    for (a = a.expirationTimes; 0 < c; ) {
      var e = 31 - oc(c), f = 1 << e;
      b[e] = 0;
      d[e] = -1;
      a[e] = -1;
      c &= ~f;
    }
  }
  function Cc(a, b) {
    var c = a.entangledLanes |= b;
    for (a = a.entanglements; c; ) {
      var d = 31 - oc(c), e = 1 << d;
      e & b | a[d] & b && (a[d] |= b);
      c &= ~e;
    }
  }
  var C = 0;
  function Dc(a) {
    a &= -a;
    return 1 < a ? 4 < a ? 0 !== (a & 268435455) ? 16 : 536870912 : 4 : 1;
  }
  var Ec, Fc, Gc, Hc, Ic, Jc = false, Kc = [], Lc = null, Mc = null, Nc = null, Oc = /* @__PURE__ */ new Map(), Pc = /* @__PURE__ */ new Map(), Qc = [], Rc = "mousedown mouseup touchcancel touchend touchstart auxclick dblclick pointercancel pointerdown pointerup dragend dragstart drop compositionend compositionstart keydown keypress keyup input textInput copy cut paste click change contextmenu reset submit".split(" ");
  function Sc(a, b) {
    switch (a) {
      case "focusin":
      case "focusout":
        Lc = null;
        break;
      case "dragenter":
      case "dragleave":
        Mc = null;
        break;
      case "mouseover":
      case "mouseout":
        Nc = null;
        break;
      case "pointerover":
      case "pointerout":
        Oc.delete(b.pointerId);
        break;
      case "gotpointercapture":
      case "lostpointercapture":
        Pc.delete(b.pointerId);
    }
  }
  function Tc(a, b, c, d, e, f) {
    if (null === a || a.nativeEvent !== f) return a = { blockedOn: b, domEventName: c, eventSystemFlags: d, nativeEvent: f, targetContainers: [e] }, null !== b && (b = Cb(b), null !== b && Fc(b)), a;
    a.eventSystemFlags |= d;
    b = a.targetContainers;
    null !== e && -1 === b.indexOf(e) && b.push(e);
    return a;
  }
  function Uc(a, b, c, d, e) {
    switch (b) {
      case "focusin":
        return Lc = Tc(Lc, a, b, c, d, e), true;
      case "dragenter":
        return Mc = Tc(Mc, a, b, c, d, e), true;
      case "mouseover":
        return Nc = Tc(Nc, a, b, c, d, e), true;
      case "pointerover":
        var f = e.pointerId;
        Oc.set(f, Tc(Oc.get(f) || null, a, b, c, d, e));
        return true;
      case "gotpointercapture":
        return f = e.pointerId, Pc.set(f, Tc(Pc.get(f) || null, a, b, c, d, e)), true;
    }
    return false;
  }
  function Vc(a) {
    var b = Wc(a.target);
    if (null !== b) {
      var c = Vb(b);
      if (null !== c) {
        if (b = c.tag, 13 === b) {
          if (b = Wb(c), null !== b) {
            a.blockedOn = b;
            Ic(a.priority, function() {
              Gc(c);
            });
            return;
          }
        } else if (3 === b && c.stateNode.current.memoizedState.isDehydrated) {
          a.blockedOn = 3 === c.tag ? c.stateNode.containerInfo : null;
          return;
        }
      }
    }
    a.blockedOn = null;
  }
  function Xc(a) {
    if (null !== a.blockedOn) return false;
    for (var b = a.targetContainers; 0 < b.length; ) {
      var c = Yc(a.domEventName, a.eventSystemFlags, b[0], a.nativeEvent);
      if (null === c) {
        c = a.nativeEvent;
        var d = new c.constructor(c.type, c);
        wb = d;
        c.target.dispatchEvent(d);
        wb = null;
      } else return b = Cb(c), null !== b && Fc(b), a.blockedOn = c, false;
      b.shift();
    }
    return true;
  }
  function Zc(a, b, c) {
    Xc(a) && c.delete(b);
  }
  function $c() {
    Jc = false;
    null !== Lc && Xc(Lc) && (Lc = null);
    null !== Mc && Xc(Mc) && (Mc = null);
    null !== Nc && Xc(Nc) && (Nc = null);
    Oc.forEach(Zc);
    Pc.forEach(Zc);
  }
  function ad(a, b) {
    a.blockedOn === b && (a.blockedOn = null, Jc || (Jc = true, ca.unstable_scheduleCallback(ca.unstable_NormalPriority, $c)));
  }
  function bd(a) {
    function b(b2) {
      return ad(b2, a);
    }
    if (0 < Kc.length) {
      ad(Kc[0], a);
      for (var c = 1; c < Kc.length; c++) {
        var d = Kc[c];
        d.blockedOn === a && (d.blockedOn = null);
      }
    }
    null !== Lc && ad(Lc, a);
    null !== Mc && ad(Mc, a);
    null !== Nc && ad(Nc, a);
    Oc.forEach(b);
    Pc.forEach(b);
    for (c = 0; c < Qc.length; c++) d = Qc[c], d.blockedOn === a && (d.blockedOn = null);
    for (; 0 < Qc.length && (c = Qc[0], null === c.blockedOn); ) Vc(c), null === c.blockedOn && Qc.shift();
  }
  var cd = ua.ReactCurrentBatchConfig, dd = true;
  function ed(a, b, c, d) {
    var e = C, f = cd.transition;
    cd.transition = null;
    try {
      C = 1, fd(a, b, c, d);
    } finally {
      C = e, cd.transition = f;
    }
  }
  function gd(a, b, c, d) {
    var e = C, f = cd.transition;
    cd.transition = null;
    try {
      C = 4, fd(a, b, c, d);
    } finally {
      C = e, cd.transition = f;
    }
  }
  function fd(a, b, c, d) {
    if (dd) {
      var e = Yc(a, b, c, d);
      if (null === e) hd(a, b, d, id, c), Sc(a, d);
      else if (Uc(e, a, b, c, d)) d.stopPropagation();
      else if (Sc(a, d), b & 4 && -1 < Rc.indexOf(a)) {
        for (; null !== e; ) {
          var f = Cb(e);
          null !== f && Ec(f);
          f = Yc(a, b, c, d);
          null === f && hd(a, b, d, id, c);
          if (f === e) break;
          e = f;
        }
        null !== e && d.stopPropagation();
      } else hd(a, b, d, null, c);
    }
  }
  var id = null;
  function Yc(a, b, c, d) {
    id = null;
    a = xb(d);
    a = Wc(a);
    if (null !== a) if (b = Vb(a), null === b) a = null;
    else if (c = b.tag, 13 === c) {
      a = Wb(b);
      if (null !== a) return a;
      a = null;
    } else if (3 === c) {
      if (b.stateNode.current.memoizedState.isDehydrated) return 3 === b.tag ? b.stateNode.containerInfo : null;
      a = null;
    } else b !== a && (a = null);
    id = a;
    return null;
  }
  function jd(a) {
    switch (a) {
      case "cancel":
      case "click":
      case "close":
      case "contextmenu":
      case "copy":
      case "cut":
      case "auxclick":
      case "dblclick":
      case "dragend":
      case "dragstart":
      case "drop":
      case "focusin":
      case "focusout":
      case "input":
      case "invalid":
      case "keydown":
      case "keypress":
      case "keyup":
      case "mousedown":
      case "mouseup":
      case "paste":
      case "pause":
      case "play":
      case "pointercancel":
      case "pointerdown":
      case "pointerup":
      case "ratechange":
      case "reset":
      case "resize":
      case "seeked":
      case "submit":
      case "touchcancel":
      case "touchend":
      case "touchstart":
      case "volumechange":
      case "change":
      case "selectionchange":
      case "textInput":
      case "compositionstart":
      case "compositionend":
      case "compositionupdate":
      case "beforeblur":
      case "afterblur":
      case "beforeinput":
      case "blur":
      case "fullscreenchange":
      case "focus":
      case "hashchange":
      case "popstate":
      case "select":
      case "selectstart":
        return 1;
      case "drag":
      case "dragenter":
      case "dragexit":
      case "dragleave":
      case "dragover":
      case "mousemove":
      case "mouseout":
      case "mouseover":
      case "pointermove":
      case "pointerout":
      case "pointerover":
      case "scroll":
      case "toggle":
      case "touchmove":
      case "wheel":
      case "mouseenter":
      case "mouseleave":
      case "pointerenter":
      case "pointerleave":
        return 4;
      case "message":
        switch (ec()) {
          case fc:
            return 1;
          case gc:
            return 4;
          case hc:
          case ic:
            return 16;
          case jc:
            return 536870912;
          default:
            return 16;
        }
      default:
        return 16;
    }
  }
  var kd = null, ld = null, md = null;
  function nd() {
    if (md) return md;
    var a, b = ld, c = b.length, d, e = "value" in kd ? kd.value : kd.textContent, f = e.length;
    for (a = 0; a < c && b[a] === e[a]; a++) ;
    var g = c - a;
    for (d = 1; d <= g && b[c - d] === e[f - d]; d++) ;
    return md = e.slice(a, 1 < d ? 1 - d : void 0);
  }
  function od(a) {
    var b = a.keyCode;
    "charCode" in a ? (a = a.charCode, 0 === a && 13 === b && (a = 13)) : a = b;
    10 === a && (a = 13);
    return 32 <= a || 13 === a ? a : 0;
  }
  function pd() {
    return true;
  }
  function qd() {
    return false;
  }
  function rd(a) {
    function b(b2, d, e, f, g) {
      this._reactName = b2;
      this._targetInst = e;
      this.type = d;
      this.nativeEvent = f;
      this.target = g;
      this.currentTarget = null;
      for (var c in a) a.hasOwnProperty(c) && (b2 = a[c], this[c] = b2 ? b2(f) : f[c]);
      this.isDefaultPrevented = (null != f.defaultPrevented ? f.defaultPrevented : false === f.returnValue) ? pd : qd;
      this.isPropagationStopped = qd;
      return this;
    }
    A(b.prototype, { preventDefault: function() {
      this.defaultPrevented = true;
      var a2 = this.nativeEvent;
      a2 && (a2.preventDefault ? a2.preventDefault() : "unknown" !== typeof a2.returnValue && (a2.returnValue = false), this.isDefaultPrevented = pd);
    }, stopPropagation: function() {
      var a2 = this.nativeEvent;
      a2 && (a2.stopPropagation ? a2.stopPropagation() : "unknown" !== typeof a2.cancelBubble && (a2.cancelBubble = true), this.isPropagationStopped = pd);
    }, persist: function() {
    }, isPersistent: pd });
    return b;
  }
  var sd = { eventPhase: 0, bubbles: 0, cancelable: 0, timeStamp: function(a) {
    return a.timeStamp || Date.now();
  }, defaultPrevented: 0, isTrusted: 0 }, td = rd(sd), ud = A({}, sd, { view: 0, detail: 0 }), vd = rd(ud), wd, xd, yd, Ad = A({}, ud, { screenX: 0, screenY: 0, clientX: 0, clientY: 0, pageX: 0, pageY: 0, ctrlKey: 0, shiftKey: 0, altKey: 0, metaKey: 0, getModifierState: zd, button: 0, buttons: 0, relatedTarget: function(a) {
    return void 0 === a.relatedTarget ? a.fromElement === a.srcElement ? a.toElement : a.fromElement : a.relatedTarget;
  }, movementX: function(a) {
    if ("movementX" in a) return a.movementX;
    a !== yd && (yd && "mousemove" === a.type ? (wd = a.screenX - yd.screenX, xd = a.screenY - yd.screenY) : xd = wd = 0, yd = a);
    return wd;
  }, movementY: function(a) {
    return "movementY" in a ? a.movementY : xd;
  } }), Bd = rd(Ad), Cd = A({}, Ad, { dataTransfer: 0 }), Dd = rd(Cd), Ed = A({}, ud, { relatedTarget: 0 }), Fd = rd(Ed), Gd = A({}, sd, { animationName: 0, elapsedTime: 0, pseudoElement: 0 }), Hd = rd(Gd), Id = A({}, sd, { clipboardData: function(a) {
    return "clipboardData" in a ? a.clipboardData : window.clipboardData;
  } }), Jd = rd(Id), Kd = A({}, sd, { data: 0 }), Ld = rd(Kd), Md = {
    Esc: "Escape",
    Spacebar: " ",
    Left: "ArrowLeft",
    Up: "ArrowUp",
    Right: "ArrowRight",
    Down: "ArrowDown",
    Del: "Delete",
    Win: "OS",
    Menu: "ContextMenu",
    Apps: "ContextMenu",
    Scroll: "ScrollLock",
    MozPrintableKey: "Unidentified"
  }, Nd = {
    8: "Backspace",
    9: "Tab",
    12: "Clear",
    13: "Enter",
    16: "Shift",
    17: "Control",
    18: "Alt",
    19: "Pause",
    20: "CapsLock",
    27: "Escape",
    32: " ",
    33: "PageUp",
    34: "PageDown",
    35: "End",
    36: "Home",
    37: "ArrowLeft",
    38: "ArrowUp",
    39: "ArrowRight",
    40: "ArrowDown",
    45: "Insert",
    46: "Delete",
    112: "F1",
    113: "F2",
    114: "F3",
    115: "F4",
    116: "F5",
    117: "F6",
    118: "F7",
    119: "F8",
    120: "F9",
    121: "F10",
    122: "F11",
    123: "F12",
    144: "NumLock",
    145: "ScrollLock",
    224: "Meta"
  }, Od = { Alt: "altKey", Control: "ctrlKey", Meta: "metaKey", Shift: "shiftKey" };
  function Pd(a) {
    var b = this.nativeEvent;
    return b.getModifierState ? b.getModifierState(a) : (a = Od[a]) ? !!b[a] : false;
  }
  function zd() {
    return Pd;
  }
  var Qd = A({}, ud, { key: function(a) {
    if (a.key) {
      var b = Md[a.key] || a.key;
      if ("Unidentified" !== b) return b;
    }
    return "keypress" === a.type ? (a = od(a), 13 === a ? "Enter" : String.fromCharCode(a)) : "keydown" === a.type || "keyup" === a.type ? Nd[a.keyCode] || "Unidentified" : "";
  }, code: 0, location: 0, ctrlKey: 0, shiftKey: 0, altKey: 0, metaKey: 0, repeat: 0, locale: 0, getModifierState: zd, charCode: function(a) {
    return "keypress" === a.type ? od(a) : 0;
  }, keyCode: function(a) {
    return "keydown" === a.type || "keyup" === a.type ? a.keyCode : 0;
  }, which: function(a) {
    return "keypress" === a.type ? od(a) : "keydown" === a.type || "keyup" === a.type ? a.keyCode : 0;
  } }), Rd = rd(Qd), Sd = A({}, Ad, { pointerId: 0, width: 0, height: 0, pressure: 0, tangentialPressure: 0, tiltX: 0, tiltY: 0, twist: 0, pointerType: 0, isPrimary: 0 }), Td = rd(Sd), Ud = A({}, ud, { touches: 0, targetTouches: 0, changedTouches: 0, altKey: 0, metaKey: 0, ctrlKey: 0, shiftKey: 0, getModifierState: zd }), Vd = rd(Ud), Wd = A({}, sd, { propertyName: 0, elapsedTime: 0, pseudoElement: 0 }), Xd = rd(Wd), Yd = A({}, Ad, {
    deltaX: function(a) {
      return "deltaX" in a ? a.deltaX : "wheelDeltaX" in a ? -a.wheelDeltaX : 0;
    },
    deltaY: function(a) {
      return "deltaY" in a ? a.deltaY : "wheelDeltaY" in a ? -a.wheelDeltaY : "wheelDelta" in a ? -a.wheelDelta : 0;
    },
    deltaZ: 0,
    deltaMode: 0
  }), Zd = rd(Yd), $d = [9, 13, 27, 32], ae = ia && "CompositionEvent" in window, be = null;
  ia && "documentMode" in document && (be = document.documentMode);
  var ce = ia && "TextEvent" in window && !be, de = ia && (!ae || be && 8 < be && 11 >= be), ee = String.fromCharCode(32), fe = false;
  function ge(a, b) {
    switch (a) {
      case "keyup":
        return -1 !== $d.indexOf(b.keyCode);
      case "keydown":
        return 229 !== b.keyCode;
      case "keypress":
      case "mousedown":
      case "focusout":
        return true;
      default:
        return false;
    }
  }
  function he(a) {
    a = a.detail;
    return "object" === typeof a && "data" in a ? a.data : null;
  }
  var ie = false;
  function je(a, b) {
    switch (a) {
      case "compositionend":
        return he(b);
      case "keypress":
        if (32 !== b.which) return null;
        fe = true;
        return ee;
      case "textInput":
        return a = b.data, a === ee && fe ? null : a;
      default:
        return null;
    }
  }
  function ke(a, b) {
    if (ie) return "compositionend" === a || !ae && ge(a, b) ? (a = nd(), md = ld = kd = null, ie = false, a) : null;
    switch (a) {
      case "paste":
        return null;
      case "keypress":
        if (!(b.ctrlKey || b.altKey || b.metaKey) || b.ctrlKey && b.altKey) {
          if (b.char && 1 < b.char.length) return b.char;
          if (b.which) return String.fromCharCode(b.which);
        }
        return null;
      case "compositionend":
        return de && "ko" !== b.locale ? null : b.data;
      default:
        return null;
    }
  }
  var le = { color: true, date: true, datetime: true, "datetime-local": true, email: true, month: true, number: true, password: true, range: true, search: true, tel: true, text: true, time: true, url: true, week: true };
  function me(a) {
    var b = a && a.nodeName && a.nodeName.toLowerCase();
    return "input" === b ? !!le[a.type] : "textarea" === b ? true : false;
  }
  function ne(a, b, c, d) {
    Eb(d);
    b = oe(b, "onChange");
    0 < b.length && (c = new td("onChange", "change", null, c, d), a.push({ event: c, listeners: b }));
  }
  var pe = null, qe = null;
  function re(a) {
    se(a, 0);
  }
  function te(a) {
    var b = ue(a);
    if (Wa(b)) return a;
  }
  function ve(a, b) {
    if ("change" === a) return b;
  }
  var we = false;
  if (ia) {
    var xe;
    if (ia) {
      var ye = "oninput" in document;
      if (!ye) {
        var ze = document.createElement("div");
        ze.setAttribute("oninput", "return;");
        ye = "function" === typeof ze.oninput;
      }
      xe = ye;
    } else xe = false;
    we = xe && (!document.documentMode || 9 < document.documentMode);
  }
  function Ae() {
    pe && (pe.detachEvent("onpropertychange", Be), qe = pe = null);
  }
  function Be(a) {
    if ("value" === a.propertyName && te(qe)) {
      var b = [];
      ne(b, qe, a, xb(a));
      Jb(re, b);
    }
  }
  function Ce(a, b, c) {
    "focusin" === a ? (Ae(), pe = b, qe = c, pe.attachEvent("onpropertychange", Be)) : "focusout" === a && Ae();
  }
  function De(a) {
    if ("selectionchange" === a || "keyup" === a || "keydown" === a) return te(qe);
  }
  function Ee(a, b) {
    if ("click" === a) return te(b);
  }
  function Fe(a, b) {
    if ("input" === a || "change" === a) return te(b);
  }
  function Ge(a, b) {
    return a === b && (0 !== a || 1 / a === 1 / b) || a !== a && b !== b;
  }
  var He = "function" === typeof Object.is ? Object.is : Ge;
  function Ie(a, b) {
    if (He(a, b)) return true;
    if ("object" !== typeof a || null === a || "object" !== typeof b || null === b) return false;
    var c = Object.keys(a), d = Object.keys(b);
    if (c.length !== d.length) return false;
    for (d = 0; d < c.length; d++) {
      var e = c[d];
      if (!ja.call(b, e) || !He(a[e], b[e])) return false;
    }
    return true;
  }
  function Je(a) {
    for (; a && a.firstChild; ) a = a.firstChild;
    return a;
  }
  function Ke(a, b) {
    var c = Je(a);
    a = 0;
    for (var d; c; ) {
      if (3 === c.nodeType) {
        d = a + c.textContent.length;
        if (a <= b && d >= b) return { node: c, offset: b - a };
        a = d;
      }
      a: {
        for (; c; ) {
          if (c.nextSibling) {
            c = c.nextSibling;
            break a;
          }
          c = c.parentNode;
        }
        c = void 0;
      }
      c = Je(c);
    }
  }
  function Le(a, b) {
    return a && b ? a === b ? true : a && 3 === a.nodeType ? false : b && 3 === b.nodeType ? Le(a, b.parentNode) : "contains" in a ? a.contains(b) : a.compareDocumentPosition ? !!(a.compareDocumentPosition(b) & 16) : false : false;
  }
  function Me() {
    for (var a = window, b = Xa(); b instanceof a.HTMLIFrameElement; ) {
      try {
        var c = "string" === typeof b.contentWindow.location.href;
      } catch (d) {
        c = false;
      }
      if (c) a = b.contentWindow;
      else break;
      b = Xa(a.document);
    }
    return b;
  }
  function Ne(a) {
    var b = a && a.nodeName && a.nodeName.toLowerCase();
    return b && ("input" === b && ("text" === a.type || "search" === a.type || "tel" === a.type || "url" === a.type || "password" === a.type) || "textarea" === b || "true" === a.contentEditable);
  }
  function Oe(a) {
    var b = Me(), c = a.focusedElem, d = a.selectionRange;
    if (b !== c && c && c.ownerDocument && Le(c.ownerDocument.documentElement, c)) {
      if (null !== d && Ne(c)) {
        if (b = d.start, a = d.end, void 0 === a && (a = b), "selectionStart" in c) c.selectionStart = b, c.selectionEnd = Math.min(a, c.value.length);
        else if (a = (b = c.ownerDocument || document) && b.defaultView || window, a.getSelection) {
          a = a.getSelection();
          var e = c.textContent.length, f = Math.min(d.start, e);
          d = void 0 === d.end ? f : Math.min(d.end, e);
          !a.extend && f > d && (e = d, d = f, f = e);
          e = Ke(c, f);
          var g = Ke(
            c,
            d
          );
          e && g && (1 !== a.rangeCount || a.anchorNode !== e.node || a.anchorOffset !== e.offset || a.focusNode !== g.node || a.focusOffset !== g.offset) && (b = b.createRange(), b.setStart(e.node, e.offset), a.removeAllRanges(), f > d ? (a.addRange(b), a.extend(g.node, g.offset)) : (b.setEnd(g.node, g.offset), a.addRange(b)));
        }
      }
      b = [];
      for (a = c; a = a.parentNode; ) 1 === a.nodeType && b.push({ element: a, left: a.scrollLeft, top: a.scrollTop });
      "function" === typeof c.focus && c.focus();
      for (c = 0; c < b.length; c++) a = b[c], a.element.scrollLeft = a.left, a.element.scrollTop = a.top;
    }
  }
  var Pe = ia && "documentMode" in document && 11 >= document.documentMode, Qe = null, Re = null, Se = null, Te = false;
  function Ue(a, b, c) {
    var d = c.window === c ? c.document : 9 === c.nodeType ? c : c.ownerDocument;
    Te || null == Qe || Qe !== Xa(d) || (d = Qe, "selectionStart" in d && Ne(d) ? d = { start: d.selectionStart, end: d.selectionEnd } : (d = (d.ownerDocument && d.ownerDocument.defaultView || window).getSelection(), d = { anchorNode: d.anchorNode, anchorOffset: d.anchorOffset, focusNode: d.focusNode, focusOffset: d.focusOffset }), Se && Ie(Se, d) || (Se = d, d = oe(Re, "onSelect"), 0 < d.length && (b = new td("onSelect", "select", null, b, c), a.push({ event: b, listeners: d }), b.target = Qe)));
  }
  function Ve(a, b) {
    var c = {};
    c[a.toLowerCase()] = b.toLowerCase();
    c["Webkit" + a] = "webkit" + b;
    c["Moz" + a] = "moz" + b;
    return c;
  }
  var We = { animationend: Ve("Animation", "AnimationEnd"), animationiteration: Ve("Animation", "AnimationIteration"), animationstart: Ve("Animation", "AnimationStart"), transitionend: Ve("Transition", "TransitionEnd") }, Xe = {}, Ye = {};
  ia && (Ye = document.createElement("div").style, "AnimationEvent" in window || (delete We.animationend.animation, delete We.animationiteration.animation, delete We.animationstart.animation), "TransitionEvent" in window || delete We.transitionend.transition);
  function Ze(a) {
    if (Xe[a]) return Xe[a];
    if (!We[a]) return a;
    var b = We[a], c;
    for (c in b) if (b.hasOwnProperty(c) && c in Ye) return Xe[a] = b[c];
    return a;
  }
  var $e = Ze("animationend"), af = Ze("animationiteration"), bf = Ze("animationstart"), cf = Ze("transitionend"), df = /* @__PURE__ */ new Map(), ef = "abort auxClick cancel canPlay canPlayThrough click close contextMenu copy cut drag dragEnd dragEnter dragExit dragLeave dragOver dragStart drop durationChange emptied encrypted ended error gotPointerCapture input invalid keyDown keyPress keyUp load loadedData loadedMetadata loadStart lostPointerCapture mouseDown mouseMove mouseOut mouseOver mouseUp paste pause play playing pointerCancel pointerDown pointerMove pointerOut pointerOver pointerUp progress rateChange reset resize seeked seeking stalled submit suspend timeUpdate touchCancel touchEnd touchStart volumeChange scroll toggle touchMove waiting wheel".split(" ");
  function ff(a, b) {
    df.set(a, b);
    fa(b, [a]);
  }
  for (var gf = 0; gf < ef.length; gf++) {
    var hf = ef[gf], jf = hf.toLowerCase(), kf = hf[0].toUpperCase() + hf.slice(1);
    ff(jf, "on" + kf);
  }
  ff($e, "onAnimationEnd");
  ff(af, "onAnimationIteration");
  ff(bf, "onAnimationStart");
  ff("dblclick", "onDoubleClick");
  ff("focusin", "onFocus");
  ff("focusout", "onBlur");
  ff(cf, "onTransitionEnd");
  ha("onMouseEnter", ["mouseout", "mouseover"]);
  ha("onMouseLeave", ["mouseout", "mouseover"]);
  ha("onPointerEnter", ["pointerout", "pointerover"]);
  ha("onPointerLeave", ["pointerout", "pointerover"]);
  fa("onChange", "change click focusin focusout input keydown keyup selectionchange".split(" "));
  fa("onSelect", "focusout contextmenu dragend focusin keydown keyup mousedown mouseup selectionchange".split(" "));
  fa("onBeforeInput", ["compositionend", "keypress", "textInput", "paste"]);
  fa("onCompositionEnd", "compositionend focusout keydown keypress keyup mousedown".split(" "));
  fa("onCompositionStart", "compositionstart focusout keydown keypress keyup mousedown".split(" "));
  fa("onCompositionUpdate", "compositionupdate focusout keydown keypress keyup mousedown".split(" "));
  var lf = "abort canplay canplaythrough durationchange emptied encrypted ended error loadeddata loadedmetadata loadstart pause play playing progress ratechange resize seeked seeking stalled suspend timeupdate volumechange waiting".split(" "), mf = new Set("cancel close invalid load scroll toggle".split(" ").concat(lf));
  function nf(a, b, c) {
    var d = a.type || "unknown-event";
    a.currentTarget = c;
    Ub(d, b, void 0, a);
    a.currentTarget = null;
  }
  function se(a, b) {
    b = 0 !== (b & 4);
    for (var c = 0; c < a.length; c++) {
      var d = a[c], e = d.event;
      d = d.listeners;
      a: {
        var f = void 0;
        if (b) for (var g = d.length - 1; 0 <= g; g--) {
          var h = d[g], k = h.instance, l = h.currentTarget;
          h = h.listener;
          if (k !== f && e.isPropagationStopped()) break a;
          nf(e, h, l);
          f = k;
        }
        else for (g = 0; g < d.length; g++) {
          h = d[g];
          k = h.instance;
          l = h.currentTarget;
          h = h.listener;
          if (k !== f && e.isPropagationStopped()) break a;
          nf(e, h, l);
          f = k;
        }
      }
    }
    if (Qb) throw a = Rb, Qb = false, Rb = null, a;
  }
  function D(a, b) {
    var c = b[of];
    void 0 === c && (c = b[of] = /* @__PURE__ */ new Set());
    var d = a + "__bubble";
    c.has(d) || (pf(b, a, 2, false), c.add(d));
  }
  function qf(a, b, c) {
    var d = 0;
    b && (d |= 4);
    pf(c, a, d, b);
  }
  var rf = "_reactListening" + Math.random().toString(36).slice(2);
  function sf(a) {
    if (!a[rf]) {
      a[rf] = true;
      da.forEach(function(b2) {
        "selectionchange" !== b2 && (mf.has(b2) || qf(b2, false, a), qf(b2, true, a));
      });
      var b = 9 === a.nodeType ? a : a.ownerDocument;
      null === b || b[rf] || (b[rf] = true, qf("selectionchange", false, b));
    }
  }
  function pf(a, b, c, d) {
    switch (jd(b)) {
      case 1:
        var e = ed;
        break;
      case 4:
        e = gd;
        break;
      default:
        e = fd;
    }
    c = e.bind(null, b, c, a);
    e = void 0;
    !Lb || "touchstart" !== b && "touchmove" !== b && "wheel" !== b || (e = true);
    d ? void 0 !== e ? a.addEventListener(b, c, { capture: true, passive: e }) : a.addEventListener(b, c, true) : void 0 !== e ? a.addEventListener(b, c, { passive: e }) : a.addEventListener(b, c, false);
  }
  function hd(a, b, c, d, e) {
    var f = d;
    if (0 === (b & 1) && 0 === (b & 2) && null !== d) a: for (; ; ) {
      if (null === d) return;
      var g = d.tag;
      if (3 === g || 4 === g) {
        var h = d.stateNode.containerInfo;
        if (h === e || 8 === h.nodeType && h.parentNode === e) break;
        if (4 === g) for (g = d.return; null !== g; ) {
          var k = g.tag;
          if (3 === k || 4 === k) {
            if (k = g.stateNode.containerInfo, k === e || 8 === k.nodeType && k.parentNode === e) return;
          }
          g = g.return;
        }
        for (; null !== h; ) {
          g = Wc(h);
          if (null === g) return;
          k = g.tag;
          if (5 === k || 6 === k) {
            d = f = g;
            continue a;
          }
          h = h.parentNode;
        }
      }
      d = d.return;
    }
    Jb(function() {
      var d2 = f, e2 = xb(c), g2 = [];
      a: {
        var h2 = df.get(a);
        if (void 0 !== h2) {
          var k2 = td, n = a;
          switch (a) {
            case "keypress":
              if (0 === od(c)) break a;
            case "keydown":
            case "keyup":
              k2 = Rd;
              break;
            case "focusin":
              n = "focus";
              k2 = Fd;
              break;
            case "focusout":
              n = "blur";
              k2 = Fd;
              break;
            case "beforeblur":
            case "afterblur":
              k2 = Fd;
              break;
            case "click":
              if (2 === c.button) break a;
            case "auxclick":
            case "dblclick":
            case "mousedown":
            case "mousemove":
            case "mouseup":
            case "mouseout":
            case "mouseover":
            case "contextmenu":
              k2 = Bd;
              break;
            case "drag":
            case "dragend":
            case "dragenter":
            case "dragexit":
            case "dragleave":
            case "dragover":
            case "dragstart":
            case "drop":
              k2 = Dd;
              break;
            case "touchcancel":
            case "touchend":
            case "touchmove":
            case "touchstart":
              k2 = Vd;
              break;
            case $e:
            case af:
            case bf:
              k2 = Hd;
              break;
            case cf:
              k2 = Xd;
              break;
            case "scroll":
              k2 = vd;
              break;
            case "wheel":
              k2 = Zd;
              break;
            case "copy":
            case "cut":
            case "paste":
              k2 = Jd;
              break;
            case "gotpointercapture":
            case "lostpointercapture":
            case "pointercancel":
            case "pointerdown":
            case "pointermove":
            case "pointerout":
            case "pointerover":
            case "pointerup":
              k2 = Td;
          }
          var t = 0 !== (b & 4), J = !t && "scroll" === a, x = t ? null !== h2 ? h2 + "Capture" : null : h2;
          t = [];
          for (var w = d2, u; null !== w; ) {
            u = w;
            var F = u.stateNode;
            5 === u.tag && null !== F && (u = F, null !== x && (F = Kb(w, x), null != F && t.push(tf(w, F, u))));
            if (J) break;
            w = w.return;
          }
          0 < t.length && (h2 = new k2(h2, n, null, c, e2), g2.push({ event: h2, listeners: t }));
        }
      }
      if (0 === (b & 7)) {
        a: {
          h2 = "mouseover" === a || "pointerover" === a;
          k2 = "mouseout" === a || "pointerout" === a;
          if (h2 && c !== wb && (n = c.relatedTarget || c.fromElement) && (Wc(n) || n[uf])) break a;
          if (k2 || h2) {
            h2 = e2.window === e2 ? e2 : (h2 = e2.ownerDocument) ? h2.defaultView || h2.parentWindow : window;
            if (k2) {
              if (n = c.relatedTarget || c.toElement, k2 = d2, n = n ? Wc(n) : null, null !== n && (J = Vb(n), n !== J || 5 !== n.tag && 6 !== n.tag)) n = null;
            } else k2 = null, n = d2;
            if (k2 !== n) {
              t = Bd;
              F = "onMouseLeave";
              x = "onMouseEnter";
              w = "mouse";
              if ("pointerout" === a || "pointerover" === a) t = Td, F = "onPointerLeave", x = "onPointerEnter", w = "pointer";
              J = null == k2 ? h2 : ue(k2);
              u = null == n ? h2 : ue(n);
              h2 = new t(F, w + "leave", k2, c, e2);
              h2.target = J;
              h2.relatedTarget = u;
              F = null;
              Wc(e2) === d2 && (t = new t(x, w + "enter", n, c, e2), t.target = u, t.relatedTarget = J, F = t);
              J = F;
              if (k2 && n) b: {
                t = k2;
                x = n;
                w = 0;
                for (u = t; u; u = vf(u)) w++;
                u = 0;
                for (F = x; F; F = vf(F)) u++;
                for (; 0 < w - u; ) t = vf(t), w--;
                for (; 0 < u - w; ) x = vf(x), u--;
                for (; w--; ) {
                  if (t === x || null !== x && t === x.alternate) break b;
                  t = vf(t);
                  x = vf(x);
                }
                t = null;
              }
              else t = null;
              null !== k2 && wf(g2, h2, k2, t, false);
              null !== n && null !== J && wf(g2, J, n, t, true);
            }
          }
        }
        a: {
          h2 = d2 ? ue(d2) : window;
          k2 = h2.nodeName && h2.nodeName.toLowerCase();
          if ("select" === k2 || "input" === k2 && "file" === h2.type) var na = ve;
          else if (me(h2)) if (we) na = Fe;
          else {
            na = De;
            var xa = Ce;
          }
          else (k2 = h2.nodeName) && "input" === k2.toLowerCase() && ("checkbox" === h2.type || "radio" === h2.type) && (na = Ee);
          if (na && (na = na(a, d2))) {
            ne(g2, na, c, e2);
            break a;
          }
          xa && xa(a, h2, d2);
          "focusout" === a && (xa = h2._wrapperState) && xa.controlled && "number" === h2.type && cb(h2, "number", h2.value);
        }
        xa = d2 ? ue(d2) : window;
        switch (a) {
          case "focusin":
            if (me(xa) || "true" === xa.contentEditable) Qe = xa, Re = d2, Se = null;
            break;
          case "focusout":
            Se = Re = Qe = null;
            break;
          case "mousedown":
            Te = true;
            break;
          case "contextmenu":
          case "mouseup":
          case "dragend":
            Te = false;
            Ue(g2, c, e2);
            break;
          case "selectionchange":
            if (Pe) break;
          case "keydown":
          case "keyup":
            Ue(g2, c, e2);
        }
        var $a;
        if (ae) b: {
          switch (a) {
            case "compositionstart":
              var ba = "onCompositionStart";
              break b;
            case "compositionend":
              ba = "onCompositionEnd";
              break b;
            case "compositionupdate":
              ba = "onCompositionUpdate";
              break b;
          }
          ba = void 0;
        }
        else ie ? ge(a, c) && (ba = "onCompositionEnd") : "keydown" === a && 229 === c.keyCode && (ba = "onCompositionStart");
        ba && (de && "ko" !== c.locale && (ie || "onCompositionStart" !== ba ? "onCompositionEnd" === ba && ie && ($a = nd()) : (kd = e2, ld = "value" in kd ? kd.value : kd.textContent, ie = true)), xa = oe(d2, ba), 0 < xa.length && (ba = new Ld(ba, a, null, c, e2), g2.push({ event: ba, listeners: xa }), $a ? ba.data = $a : ($a = he(c), null !== $a && (ba.data = $a))));
        if ($a = ce ? je(a, c) : ke(a, c)) d2 = oe(d2, "onBeforeInput"), 0 < d2.length && (e2 = new Ld("onBeforeInput", "beforeinput", null, c, e2), g2.push({ event: e2, listeners: d2 }), e2.data = $a);
      }
      se(g2, b);
    });
  }
  function tf(a, b, c) {
    return { instance: a, listener: b, currentTarget: c };
  }
  function oe(a, b) {
    for (var c = b + "Capture", d = []; null !== a; ) {
      var e = a, f = e.stateNode;
      5 === e.tag && null !== f && (e = f, f = Kb(a, c), null != f && d.unshift(tf(a, f, e)), f = Kb(a, b), null != f && d.push(tf(a, f, e)));
      a = a.return;
    }
    return d;
  }
  function vf(a) {
    if (null === a) return null;
    do
      a = a.return;
    while (a && 5 !== a.tag);
    return a ? a : null;
  }
  function wf(a, b, c, d, e) {
    for (var f = b._reactName, g = []; null !== c && c !== d; ) {
      var h = c, k = h.alternate, l = h.stateNode;
      if (null !== k && k === d) break;
      5 === h.tag && null !== l && (h = l, e ? (k = Kb(c, f), null != k && g.unshift(tf(c, k, h))) : e || (k = Kb(c, f), null != k && g.push(tf(c, k, h))));
      c = c.return;
    }
    0 !== g.length && a.push({ event: b, listeners: g });
  }
  var xf = /\r\n?/g, yf = /\u0000|\uFFFD/g;
  function zf(a) {
    return ("string" === typeof a ? a : "" + a).replace(xf, "\n").replace(yf, "");
  }
  function Af(a, b, c) {
    b = zf(b);
    if (zf(a) !== b && c) throw Error(p(425));
  }
  function Bf() {
  }
  var Cf = null, Df = null;
  function Ef(a, b) {
    return "textarea" === a || "noscript" === a || "string" === typeof b.children || "number" === typeof b.children || "object" === typeof b.dangerouslySetInnerHTML && null !== b.dangerouslySetInnerHTML && null != b.dangerouslySetInnerHTML.__html;
  }
  var Ff = "function" === typeof setTimeout ? setTimeout : void 0, Gf = "function" === typeof clearTimeout ? clearTimeout : void 0, Hf = "function" === typeof Promise ? Promise : void 0, Jf = "function" === typeof queueMicrotask ? queueMicrotask : "undefined" !== typeof Hf ? function(a) {
    return Hf.resolve(null).then(a).catch(If);
  } : Ff;
  function If(a) {
    setTimeout(function() {
      throw a;
    });
  }
  function Kf(a, b) {
    var c = b, d = 0;
    do {
      var e = c.nextSibling;
      a.removeChild(c);
      if (e && 8 === e.nodeType) if (c = e.data, "/$" === c) {
        if (0 === d) {
          a.removeChild(e);
          bd(b);
          return;
        }
        d--;
      } else "$" !== c && "$?" !== c && "$!" !== c || d++;
      c = e;
    } while (c);
    bd(b);
  }
  function Lf(a) {
    for (; null != a; a = a.nextSibling) {
      var b = a.nodeType;
      if (1 === b || 3 === b) break;
      if (8 === b) {
        b = a.data;
        if ("$" === b || "$!" === b || "$?" === b) break;
        if ("/$" === b) return null;
      }
    }
    return a;
  }
  function Mf(a) {
    a = a.previousSibling;
    for (var b = 0; a; ) {
      if (8 === a.nodeType) {
        var c = a.data;
        if ("$" === c || "$!" === c || "$?" === c) {
          if (0 === b) return a;
          b--;
        } else "/$" === c && b++;
      }
      a = a.previousSibling;
    }
    return null;
  }
  var Nf = Math.random().toString(36).slice(2), Of = "__reactFiber$" + Nf, Pf = "__reactProps$" + Nf, uf = "__reactContainer$" + Nf, of = "__reactEvents$" + Nf, Qf = "__reactListeners$" + Nf, Rf = "__reactHandles$" + Nf;
  function Wc(a) {
    var b = a[Of];
    if (b) return b;
    for (var c = a.parentNode; c; ) {
      if (b = c[uf] || c[Of]) {
        c = b.alternate;
        if (null !== b.child || null !== c && null !== c.child) for (a = Mf(a); null !== a; ) {
          if (c = a[Of]) return c;
          a = Mf(a);
        }
        return b;
      }
      a = c;
      c = a.parentNode;
    }
    return null;
  }
  function Cb(a) {
    a = a[Of] || a[uf];
    return !a || 5 !== a.tag && 6 !== a.tag && 13 !== a.tag && 3 !== a.tag ? null : a;
  }
  function ue(a) {
    if (5 === a.tag || 6 === a.tag) return a.stateNode;
    throw Error(p(33));
  }
  function Db(a) {
    return a[Pf] || null;
  }
  var Sf = [], Tf = -1;
  function Uf(a) {
    return { current: a };
  }
  function E(a) {
    0 > Tf || (a.current = Sf[Tf], Sf[Tf] = null, Tf--);
  }
  function G(a, b) {
    Tf++;
    Sf[Tf] = a.current;
    a.current = b;
  }
  var Vf = {}, H = Uf(Vf), Wf = Uf(false), Xf = Vf;
  function Yf(a, b) {
    var c = a.type.contextTypes;
    if (!c) return Vf;
    var d = a.stateNode;
    if (d && d.__reactInternalMemoizedUnmaskedChildContext === b) return d.__reactInternalMemoizedMaskedChildContext;
    var e = {}, f;
    for (f in c) e[f] = b[f];
    d && (a = a.stateNode, a.__reactInternalMemoizedUnmaskedChildContext = b, a.__reactInternalMemoizedMaskedChildContext = e);
    return e;
  }
  function Zf(a) {
    a = a.childContextTypes;
    return null !== a && void 0 !== a;
  }
  function $f() {
    E(Wf);
    E(H);
  }
  function ag(a, b, c) {
    if (H.current !== Vf) throw Error(p(168));
    G(H, b);
    G(Wf, c);
  }
  function bg(a, b, c) {
    var d = a.stateNode;
    b = b.childContextTypes;
    if ("function" !== typeof d.getChildContext) return c;
    d = d.getChildContext();
    for (var e in d) if (!(e in b)) throw Error(p(108, Ra(a) || "Unknown", e));
    return A({}, c, d);
  }
  function cg(a) {
    a = (a = a.stateNode) && a.__reactInternalMemoizedMergedChildContext || Vf;
    Xf = H.current;
    G(H, a);
    G(Wf, Wf.current);
    return true;
  }
  function dg(a, b, c) {
    var d = a.stateNode;
    if (!d) throw Error(p(169));
    c ? (a = bg(a, b, Xf), d.__reactInternalMemoizedMergedChildContext = a, E(Wf), E(H), G(H, a)) : E(Wf);
    G(Wf, c);
  }
  var eg = null, fg = false, gg = false;
  function hg(a) {
    null === eg ? eg = [a] : eg.push(a);
  }
  function ig(a) {
    fg = true;
    hg(a);
  }
  function jg() {
    if (!gg && null !== eg) {
      gg = true;
      var a = 0, b = C;
      try {
        var c = eg;
        for (C = 1; a < c.length; a++) {
          var d = c[a];
          do
            d = d(true);
          while (null !== d);
        }
        eg = null;
        fg = false;
      } catch (e) {
        throw null !== eg && (eg = eg.slice(a + 1)), ac(fc, jg), e;
      } finally {
        C = b, gg = false;
      }
    }
    return null;
  }
  var kg = [], lg = 0, mg = null, ng = 0, og = [], pg = 0, qg = null, rg = 1, sg = "";
  function tg(a, b) {
    kg[lg++] = ng;
    kg[lg++] = mg;
    mg = a;
    ng = b;
  }
  function ug(a, b, c) {
    og[pg++] = rg;
    og[pg++] = sg;
    og[pg++] = qg;
    qg = a;
    var d = rg;
    a = sg;
    var e = 32 - oc(d) - 1;
    d &= ~(1 << e);
    c += 1;
    var f = 32 - oc(b) + e;
    if (30 < f) {
      var g = e - e % 5;
      f = (d & (1 << g) - 1).toString(32);
      d >>= g;
      e -= g;
      rg = 1 << 32 - oc(b) + e | c << e | d;
      sg = f + a;
    } else rg = 1 << f | c << e | d, sg = a;
  }
  function vg(a) {
    null !== a.return && (tg(a, 1), ug(a, 1, 0));
  }
  function wg(a) {
    for (; a === mg; ) mg = kg[--lg], kg[lg] = null, ng = kg[--lg], kg[lg] = null;
    for (; a === qg; ) qg = og[--pg], og[pg] = null, sg = og[--pg], og[pg] = null, rg = og[--pg], og[pg] = null;
  }
  var xg = null, yg = null, I = false, zg = null;
  function Ag(a, b) {
    var c = Bg(5, null, null, 0);
    c.elementType = "DELETED";
    c.stateNode = b;
    c.return = a;
    b = a.deletions;
    null === b ? (a.deletions = [c], a.flags |= 16) : b.push(c);
  }
  function Cg(a, b) {
    switch (a.tag) {
      case 5:
        var c = a.type;
        b = 1 !== b.nodeType || c.toLowerCase() !== b.nodeName.toLowerCase() ? null : b;
        return null !== b ? (a.stateNode = b, xg = a, yg = Lf(b.firstChild), true) : false;
      case 6:
        return b = "" === a.pendingProps || 3 !== b.nodeType ? null : b, null !== b ? (a.stateNode = b, xg = a, yg = null, true) : false;
      case 13:
        return b = 8 !== b.nodeType ? null : b, null !== b ? (c = null !== qg ? { id: rg, overflow: sg } : null, a.memoizedState = { dehydrated: b, treeContext: c, retryLane: 1073741824 }, c = Bg(18, null, null, 0), c.stateNode = b, c.return = a, a.child = c, xg = a, yg = null, true) : false;
      default:
        return false;
    }
  }
  function Dg(a) {
    return 0 !== (a.mode & 1) && 0 === (a.flags & 128);
  }
  function Eg(a) {
    if (I) {
      var b = yg;
      if (b) {
        var c = b;
        if (!Cg(a, b)) {
          if (Dg(a)) throw Error(p(418));
          b = Lf(c.nextSibling);
          var d = xg;
          b && Cg(a, b) ? Ag(d, c) : (a.flags = a.flags & -4097 | 2, I = false, xg = a);
        }
      } else {
        if (Dg(a)) throw Error(p(418));
        a.flags = a.flags & -4097 | 2;
        I = false;
        xg = a;
      }
    }
  }
  function Fg(a) {
    for (a = a.return; null !== a && 5 !== a.tag && 3 !== a.tag && 13 !== a.tag; ) a = a.return;
    xg = a;
  }
  function Gg(a) {
    if (a !== xg) return false;
    if (!I) return Fg(a), I = true, false;
    var b;
    (b = 3 !== a.tag) && !(b = 5 !== a.tag) && (b = a.type, b = "head" !== b && "body" !== b && !Ef(a.type, a.memoizedProps));
    if (b && (b = yg)) {
      if (Dg(a)) throw Hg(), Error(p(418));
      for (; b; ) Ag(a, b), b = Lf(b.nextSibling);
    }
    Fg(a);
    if (13 === a.tag) {
      a = a.memoizedState;
      a = null !== a ? a.dehydrated : null;
      if (!a) throw Error(p(317));
      a: {
        a = a.nextSibling;
        for (b = 0; a; ) {
          if (8 === a.nodeType) {
            var c = a.data;
            if ("/$" === c) {
              if (0 === b) {
                yg = Lf(a.nextSibling);
                break a;
              }
              b--;
            } else "$" !== c && "$!" !== c && "$?" !== c || b++;
          }
          a = a.nextSibling;
        }
        yg = null;
      }
    } else yg = xg ? Lf(a.stateNode.nextSibling) : null;
    return true;
  }
  function Hg() {
    for (var a = yg; a; ) a = Lf(a.nextSibling);
  }
  function Ig() {
    yg = xg = null;
    I = false;
  }
  function Jg(a) {
    null === zg ? zg = [a] : zg.push(a);
  }
  var Kg = ua.ReactCurrentBatchConfig;
  function Lg(a, b, c) {
    a = c.ref;
    if (null !== a && "function" !== typeof a && "object" !== typeof a) {
      if (c._owner) {
        c = c._owner;
        if (c) {
          if (1 !== c.tag) throw Error(p(309));
          var d = c.stateNode;
        }
        if (!d) throw Error(p(147, a));
        var e = d, f = "" + a;
        if (null !== b && null !== b.ref && "function" === typeof b.ref && b.ref._stringRef === f) return b.ref;
        b = function(a2) {
          var b2 = e.refs;
          null === a2 ? delete b2[f] : b2[f] = a2;
        };
        b._stringRef = f;
        return b;
      }
      if ("string" !== typeof a) throw Error(p(284));
      if (!c._owner) throw Error(p(290, a));
    }
    return a;
  }
  function Mg(a, b) {
    a = Object.prototype.toString.call(b);
    throw Error(p(31, "[object Object]" === a ? "object with keys {" + Object.keys(b).join(", ") + "}" : a));
  }
  function Ng(a) {
    var b = a._init;
    return b(a._payload);
  }
  function Og(a) {
    function b(b2, c2) {
      if (a) {
        var d2 = b2.deletions;
        null === d2 ? (b2.deletions = [c2], b2.flags |= 16) : d2.push(c2);
      }
    }
    function c(c2, d2) {
      if (!a) return null;
      for (; null !== d2; ) b(c2, d2), d2 = d2.sibling;
      return null;
    }
    function d(a2, b2) {
      for (a2 = /* @__PURE__ */ new Map(); null !== b2; ) null !== b2.key ? a2.set(b2.key, b2) : a2.set(b2.index, b2), b2 = b2.sibling;
      return a2;
    }
    function e(a2, b2) {
      a2 = Pg(a2, b2);
      a2.index = 0;
      a2.sibling = null;
      return a2;
    }
    function f(b2, c2, d2) {
      b2.index = d2;
      if (!a) return b2.flags |= 1048576, c2;
      d2 = b2.alternate;
      if (null !== d2) return d2 = d2.index, d2 < c2 ? (b2.flags |= 2, c2) : d2;
      b2.flags |= 2;
      return c2;
    }
    function g(b2) {
      a && null === b2.alternate && (b2.flags |= 2);
      return b2;
    }
    function h(a2, b2, c2, d2) {
      if (null === b2 || 6 !== b2.tag) return b2 = Qg(c2, a2.mode, d2), b2.return = a2, b2;
      b2 = e(b2, c2);
      b2.return = a2;
      return b2;
    }
    function k(a2, b2, c2, d2) {
      var f2 = c2.type;
      if (f2 === ya) return m(a2, b2, c2.props.children, d2, c2.key);
      if (null !== b2 && (b2.elementType === f2 || "object" === typeof f2 && null !== f2 && f2.$$typeof === Ha && Ng(f2) === b2.type)) return d2 = e(b2, c2.props), d2.ref = Lg(a2, b2, c2), d2.return = a2, d2;
      d2 = Rg(c2.type, c2.key, c2.props, null, a2.mode, d2);
      d2.ref = Lg(a2, b2, c2);
      d2.return = a2;
      return d2;
    }
    function l(a2, b2, c2, d2) {
      if (null === b2 || 4 !== b2.tag || b2.stateNode.containerInfo !== c2.containerInfo || b2.stateNode.implementation !== c2.implementation) return b2 = Sg(c2, a2.mode, d2), b2.return = a2, b2;
      b2 = e(b2, c2.children || []);
      b2.return = a2;
      return b2;
    }
    function m(a2, b2, c2, d2, f2) {
      if (null === b2 || 7 !== b2.tag) return b2 = Tg(c2, a2.mode, d2, f2), b2.return = a2, b2;
      b2 = e(b2, c2);
      b2.return = a2;
      return b2;
    }
    function q(a2, b2, c2) {
      if ("string" === typeof b2 && "" !== b2 || "number" === typeof b2) return b2 = Qg("" + b2, a2.mode, c2), b2.return = a2, b2;
      if ("object" === typeof b2 && null !== b2) {
        switch (b2.$$typeof) {
          case va:
            return c2 = Rg(b2.type, b2.key, b2.props, null, a2.mode, c2), c2.ref = Lg(a2, null, b2), c2.return = a2, c2;
          case wa:
            return b2 = Sg(b2, a2.mode, c2), b2.return = a2, b2;
          case Ha:
            var d2 = b2._init;
            return q(a2, d2(b2._payload), c2);
        }
        if (eb(b2) || Ka(b2)) return b2 = Tg(b2, a2.mode, c2, null), b2.return = a2, b2;
        Mg(a2, b2);
      }
      return null;
    }
    function r(a2, b2, c2, d2) {
      var e2 = null !== b2 ? b2.key : null;
      if ("string" === typeof c2 && "" !== c2 || "number" === typeof c2) return null !== e2 ? null : h(a2, b2, "" + c2, d2);
      if ("object" === typeof c2 && null !== c2) {
        switch (c2.$$typeof) {
          case va:
            return c2.key === e2 ? k(a2, b2, c2, d2) : null;
          case wa:
            return c2.key === e2 ? l(a2, b2, c2, d2) : null;
          case Ha:
            return e2 = c2._init, r(
              a2,
              b2,
              e2(c2._payload),
              d2
            );
        }
        if (eb(c2) || Ka(c2)) return null !== e2 ? null : m(a2, b2, c2, d2, null);
        Mg(a2, c2);
      }
      return null;
    }
    function y(a2, b2, c2, d2, e2) {
      if ("string" === typeof d2 && "" !== d2 || "number" === typeof d2) return a2 = a2.get(c2) || null, h(b2, a2, "" + d2, e2);
      if ("object" === typeof d2 && null !== d2) {
        switch (d2.$$typeof) {
          case va:
            return a2 = a2.get(null === d2.key ? c2 : d2.key) || null, k(b2, a2, d2, e2);
          case wa:
            return a2 = a2.get(null === d2.key ? c2 : d2.key) || null, l(b2, a2, d2, e2);
          case Ha:
            var f2 = d2._init;
            return y(a2, b2, c2, f2(d2._payload), e2);
        }
        if (eb(d2) || Ka(d2)) return a2 = a2.get(c2) || null, m(b2, a2, d2, e2, null);
        Mg(b2, d2);
      }
      return null;
    }
    function n(e2, g2, h2, k2) {
      for (var l2 = null, m2 = null, u = g2, w = g2 = 0, x = null; null !== u && w < h2.length; w++) {
        u.index > w ? (x = u, u = null) : x = u.sibling;
        var n2 = r(e2, u, h2[w], k2);
        if (null === n2) {
          null === u && (u = x);
          break;
        }
        a && u && null === n2.alternate && b(e2, u);
        g2 = f(n2, g2, w);
        null === m2 ? l2 = n2 : m2.sibling = n2;
        m2 = n2;
        u = x;
      }
      if (w === h2.length) return c(e2, u), I && tg(e2, w), l2;
      if (null === u) {
        for (; w < h2.length; w++) u = q(e2, h2[w], k2), null !== u && (g2 = f(u, g2, w), null === m2 ? l2 = u : m2.sibling = u, m2 = u);
        I && tg(e2, w);
        return l2;
      }
      for (u = d(e2, u); w < h2.length; w++) x = y(u, e2, w, h2[w], k2), null !== x && (a && null !== x.alternate && u.delete(null === x.key ? w : x.key), g2 = f(x, g2, w), null === m2 ? l2 = x : m2.sibling = x, m2 = x);
      a && u.forEach(function(a2) {
        return b(e2, a2);
      });
      I && tg(e2, w);
      return l2;
    }
    function t(e2, g2, h2, k2) {
      var l2 = Ka(h2);
      if ("function" !== typeof l2) throw Error(p(150));
      h2 = l2.call(h2);
      if (null == h2) throw Error(p(151));
      for (var u = l2 = null, m2 = g2, w = g2 = 0, x = null, n2 = h2.next(); null !== m2 && !n2.done; w++, n2 = h2.next()) {
        m2.index > w ? (x = m2, m2 = null) : x = m2.sibling;
        var t2 = r(e2, m2, n2.value, k2);
        if (null === t2) {
          null === m2 && (m2 = x);
          break;
        }
        a && m2 && null === t2.alternate && b(e2, m2);
        g2 = f(t2, g2, w);
        null === u ? l2 = t2 : u.sibling = t2;
        u = t2;
        m2 = x;
      }
      if (n2.done) return c(
        e2,
        m2
      ), I && tg(e2, w), l2;
      if (null === m2) {
        for (; !n2.done; w++, n2 = h2.next()) n2 = q(e2, n2.value, k2), null !== n2 && (g2 = f(n2, g2, w), null === u ? l2 = n2 : u.sibling = n2, u = n2);
        I && tg(e2, w);
        return l2;
      }
      for (m2 = d(e2, m2); !n2.done; w++, n2 = h2.next()) n2 = y(m2, e2, w, n2.value, k2), null !== n2 && (a && null !== n2.alternate && m2.delete(null === n2.key ? w : n2.key), g2 = f(n2, g2, w), null === u ? l2 = n2 : u.sibling = n2, u = n2);
      a && m2.forEach(function(a2) {
        return b(e2, a2);
      });
      I && tg(e2, w);
      return l2;
    }
    function J(a2, d2, f2, h2) {
      "object" === typeof f2 && null !== f2 && f2.type === ya && null === f2.key && (f2 = f2.props.children);
      if ("object" === typeof f2 && null !== f2) {
        switch (f2.$$typeof) {
          case va:
            a: {
              for (var k2 = f2.key, l2 = d2; null !== l2; ) {
                if (l2.key === k2) {
                  k2 = f2.type;
                  if (k2 === ya) {
                    if (7 === l2.tag) {
                      c(a2, l2.sibling);
                      d2 = e(l2, f2.props.children);
                      d2.return = a2;
                      a2 = d2;
                      break a;
                    }
                  } else if (l2.elementType === k2 || "object" === typeof k2 && null !== k2 && k2.$$typeof === Ha && Ng(k2) === l2.type) {
                    c(a2, l2.sibling);
                    d2 = e(l2, f2.props);
                    d2.ref = Lg(a2, l2, f2);
                    d2.return = a2;
                    a2 = d2;
                    break a;
                  }
                  c(a2, l2);
                  break;
                } else b(a2, l2);
                l2 = l2.sibling;
              }
              f2.type === ya ? (d2 = Tg(f2.props.children, a2.mode, h2, f2.key), d2.return = a2, a2 = d2) : (h2 = Rg(f2.type, f2.key, f2.props, null, a2.mode, h2), h2.ref = Lg(a2, d2, f2), h2.return = a2, a2 = h2);
            }
            return g(a2);
          case wa:
            a: {
              for (l2 = f2.key; null !== d2; ) {
                if (d2.key === l2) if (4 === d2.tag && d2.stateNode.containerInfo === f2.containerInfo && d2.stateNode.implementation === f2.implementation) {
                  c(a2, d2.sibling);
                  d2 = e(d2, f2.children || []);
                  d2.return = a2;
                  a2 = d2;
                  break a;
                } else {
                  c(a2, d2);
                  break;
                }
                else b(a2, d2);
                d2 = d2.sibling;
              }
              d2 = Sg(f2, a2.mode, h2);
              d2.return = a2;
              a2 = d2;
            }
            return g(a2);
          case Ha:
            return l2 = f2._init, J(a2, d2, l2(f2._payload), h2);
        }
        if (eb(f2)) return n(a2, d2, f2, h2);
        if (Ka(f2)) return t(a2, d2, f2, h2);
        Mg(a2, f2);
      }
      return "string" === typeof f2 && "" !== f2 || "number" === typeof f2 ? (f2 = "" + f2, null !== d2 && 6 === d2.tag ? (c(a2, d2.sibling), d2 = e(d2, f2), d2.return = a2, a2 = d2) : (c(a2, d2), d2 = Qg(f2, a2.mode, h2), d2.return = a2, a2 = d2), g(a2)) : c(a2, d2);
    }
    return J;
  }
  var Ug = Og(true), Vg = Og(false), Wg = Uf(null), Xg = null, Yg = null, Zg = null;
  function $g() {
    Zg = Yg = Xg = null;
  }
  function ah(a) {
    var b = Wg.current;
    E(Wg);
    a._currentValue = b;
  }
  function bh(a, b, c) {
    for (; null !== a; ) {
      var d = a.alternate;
      (a.childLanes & b) !== b ? (a.childLanes |= b, null !== d && (d.childLanes |= b)) : null !== d && (d.childLanes & b) !== b && (d.childLanes |= b);
      if (a === c) break;
      a = a.return;
    }
  }
  function ch(a, b) {
    Xg = a;
    Zg = Yg = null;
    a = a.dependencies;
    null !== a && null !== a.firstContext && (0 !== (a.lanes & b) && (dh = true), a.firstContext = null);
  }
  function eh(a) {
    var b = a._currentValue;
    if (Zg !== a) if (a = { context: a, memoizedValue: b, next: null }, null === Yg) {
      if (null === Xg) throw Error(p(308));
      Yg = a;
      Xg.dependencies = { lanes: 0, firstContext: a };
    } else Yg = Yg.next = a;
    return b;
  }
  var fh = null;
  function gh(a) {
    null === fh ? fh = [a] : fh.push(a);
  }
  function hh(a, b, c, d) {
    var e = b.interleaved;
    null === e ? (c.next = c, gh(b)) : (c.next = e.next, e.next = c);
    b.interleaved = c;
    return ih(a, d);
  }
  function ih(a, b) {
    a.lanes |= b;
    var c = a.alternate;
    null !== c && (c.lanes |= b);
    c = a;
    for (a = a.return; null !== a; ) a.childLanes |= b, c = a.alternate, null !== c && (c.childLanes |= b), c = a, a = a.return;
    return 3 === c.tag ? c.stateNode : null;
  }
  var jh = false;
  function kh(a) {
    a.updateQueue = { baseState: a.memoizedState, firstBaseUpdate: null, lastBaseUpdate: null, shared: { pending: null, interleaved: null, lanes: 0 }, effects: null };
  }
  function lh(a, b) {
    a = a.updateQueue;
    b.updateQueue === a && (b.updateQueue = { baseState: a.baseState, firstBaseUpdate: a.firstBaseUpdate, lastBaseUpdate: a.lastBaseUpdate, shared: a.shared, effects: a.effects });
  }
  function mh(a, b) {
    return { eventTime: a, lane: b, tag: 0, payload: null, callback: null, next: null };
  }
  function nh(a, b, c) {
    var d = a.updateQueue;
    if (null === d) return null;
    d = d.shared;
    if (0 !== (K & 2)) {
      var e = d.pending;
      null === e ? b.next = b : (b.next = e.next, e.next = b);
      d.pending = b;
      return ih(a, c);
    }
    e = d.interleaved;
    null === e ? (b.next = b, gh(d)) : (b.next = e.next, e.next = b);
    d.interleaved = b;
    return ih(a, c);
  }
  function oh(a, b, c) {
    b = b.updateQueue;
    if (null !== b && (b = b.shared, 0 !== (c & 4194240))) {
      var d = b.lanes;
      d &= a.pendingLanes;
      c |= d;
      b.lanes = c;
      Cc(a, c);
    }
  }
  function ph(a, b) {
    var c = a.updateQueue, d = a.alternate;
    if (null !== d && (d = d.updateQueue, c === d)) {
      var e = null, f = null;
      c = c.firstBaseUpdate;
      if (null !== c) {
        do {
          var g = { eventTime: c.eventTime, lane: c.lane, tag: c.tag, payload: c.payload, callback: c.callback, next: null };
          null === f ? e = f = g : f = f.next = g;
          c = c.next;
        } while (null !== c);
        null === f ? e = f = b : f = f.next = b;
      } else e = f = b;
      c = { baseState: d.baseState, firstBaseUpdate: e, lastBaseUpdate: f, shared: d.shared, effects: d.effects };
      a.updateQueue = c;
      return;
    }
    a = c.lastBaseUpdate;
    null === a ? c.firstBaseUpdate = b : a.next = b;
    c.lastBaseUpdate = b;
  }
  function qh(a, b, c, d) {
    var e = a.updateQueue;
    jh = false;
    var f = e.firstBaseUpdate, g = e.lastBaseUpdate, h = e.shared.pending;
    if (null !== h) {
      e.shared.pending = null;
      var k = h, l = k.next;
      k.next = null;
      null === g ? f = l : g.next = l;
      g = k;
      var m = a.alternate;
      null !== m && (m = m.updateQueue, h = m.lastBaseUpdate, h !== g && (null === h ? m.firstBaseUpdate = l : h.next = l, m.lastBaseUpdate = k));
    }
    if (null !== f) {
      var q = e.baseState;
      g = 0;
      m = l = k = null;
      h = f;
      do {
        var r = h.lane, y = h.eventTime;
        if ((d & r) === r) {
          null !== m && (m = m.next = {
            eventTime: y,
            lane: 0,
            tag: h.tag,
            payload: h.payload,
            callback: h.callback,
            next: null
          });
          a: {
            var n = a, t = h;
            r = b;
            y = c;
            switch (t.tag) {
              case 1:
                n = t.payload;
                if ("function" === typeof n) {
                  q = n.call(y, q, r);
                  break a;
                }
                q = n;
                break a;
              case 3:
                n.flags = n.flags & -65537 | 128;
              case 0:
                n = t.payload;
                r = "function" === typeof n ? n.call(y, q, r) : n;
                if (null === r || void 0 === r) break a;
                q = A({}, q, r);
                break a;
              case 2:
                jh = true;
            }
          }
          null !== h.callback && 0 !== h.lane && (a.flags |= 64, r = e.effects, null === r ? e.effects = [h] : r.push(h));
        } else y = { eventTime: y, lane: r, tag: h.tag, payload: h.payload, callback: h.callback, next: null }, null === m ? (l = m = y, k = q) : m = m.next = y, g |= r;
        h = h.next;
        if (null === h) if (h = e.shared.pending, null === h) break;
        else r = h, h = r.next, r.next = null, e.lastBaseUpdate = r, e.shared.pending = null;
      } while (1);
      null === m && (k = q);
      e.baseState = k;
      e.firstBaseUpdate = l;
      e.lastBaseUpdate = m;
      b = e.shared.interleaved;
      if (null !== b) {
        e = b;
        do
          g |= e.lane, e = e.next;
        while (e !== b);
      } else null === f && (e.shared.lanes = 0);
      rh |= g;
      a.lanes = g;
      a.memoizedState = q;
    }
  }
  function sh(a, b, c) {
    a = b.effects;
    b.effects = null;
    if (null !== a) for (b = 0; b < a.length; b++) {
      var d = a[b], e = d.callback;
      if (null !== e) {
        d.callback = null;
        d = c;
        if ("function" !== typeof e) throw Error(p(191, e));
        e.call(d);
      }
    }
  }
  var th = {}, uh = Uf(th), vh = Uf(th), wh = Uf(th);
  function xh(a) {
    if (a === th) throw Error(p(174));
    return a;
  }
  function yh(a, b) {
    G(wh, b);
    G(vh, a);
    G(uh, th);
    a = b.nodeType;
    switch (a) {
      case 9:
      case 11:
        b = (b = b.documentElement) ? b.namespaceURI : lb(null, "");
        break;
      default:
        a = 8 === a ? b.parentNode : b, b = a.namespaceURI || null, a = a.tagName, b = lb(b, a);
    }
    E(uh);
    G(uh, b);
  }
  function zh() {
    E(uh);
    E(vh);
    E(wh);
  }
  function Ah(a) {
    xh(wh.current);
    var b = xh(uh.current);
    var c = lb(b, a.type);
    b !== c && (G(vh, a), G(uh, c));
  }
  function Bh(a) {
    vh.current === a && (E(uh), E(vh));
  }
  var L = Uf(0);
  function Ch(a) {
    for (var b = a; null !== b; ) {
      if (13 === b.tag) {
        var c = b.memoizedState;
        if (null !== c && (c = c.dehydrated, null === c || "$?" === c.data || "$!" === c.data)) return b;
      } else if (19 === b.tag && void 0 !== b.memoizedProps.revealOrder) {
        if (0 !== (b.flags & 128)) return b;
      } else if (null !== b.child) {
        b.child.return = b;
        b = b.child;
        continue;
      }
      if (b === a) break;
      for (; null === b.sibling; ) {
        if (null === b.return || b.return === a) return null;
        b = b.return;
      }
      b.sibling.return = b.return;
      b = b.sibling;
    }
    return null;
  }
  var Dh = [];
  function Eh() {
    for (var a = 0; a < Dh.length; a++) Dh[a]._workInProgressVersionPrimary = null;
    Dh.length = 0;
  }
  var Fh = ua.ReactCurrentDispatcher, Gh = ua.ReactCurrentBatchConfig, Hh = 0, M = null, N = null, O = null, Ih = false, Jh = false, Kh = 0, Lh = 0;
  function P() {
    throw Error(p(321));
  }
  function Mh(a, b) {
    if (null === b) return false;
    for (var c = 0; c < b.length && c < a.length; c++) if (!He(a[c], b[c])) return false;
    return true;
  }
  function Nh(a, b, c, d, e, f) {
    Hh = f;
    M = b;
    b.memoizedState = null;
    b.updateQueue = null;
    b.lanes = 0;
    Fh.current = null === a || null === a.memoizedState ? Oh : Ph;
    a = c(d, e);
    if (Jh) {
      f = 0;
      do {
        Jh = false;
        Kh = 0;
        if (25 <= f) throw Error(p(301));
        f += 1;
        O = N = null;
        b.updateQueue = null;
        Fh.current = Qh;
        a = c(d, e);
      } while (Jh);
    }
    Fh.current = Rh;
    b = null !== N && null !== N.next;
    Hh = 0;
    O = N = M = null;
    Ih = false;
    if (b) throw Error(p(300));
    return a;
  }
  function Sh() {
    var a = 0 !== Kh;
    Kh = 0;
    return a;
  }
  function Th() {
    var a = { memoizedState: null, baseState: null, baseQueue: null, queue: null, next: null };
    null === O ? M.memoizedState = O = a : O = O.next = a;
    return O;
  }
  function Uh() {
    if (null === N) {
      var a = M.alternate;
      a = null !== a ? a.memoizedState : null;
    } else a = N.next;
    var b = null === O ? M.memoizedState : O.next;
    if (null !== b) O = b, N = a;
    else {
      if (null === a) throw Error(p(310));
      N = a;
      a = { memoizedState: N.memoizedState, baseState: N.baseState, baseQueue: N.baseQueue, queue: N.queue, next: null };
      null === O ? M.memoizedState = O = a : O = O.next = a;
    }
    return O;
  }
  function Vh(a, b) {
    return "function" === typeof b ? b(a) : b;
  }
  function Wh(a) {
    var b = Uh(), c = b.queue;
    if (null === c) throw Error(p(311));
    c.lastRenderedReducer = a;
    var d = N, e = d.baseQueue, f = c.pending;
    if (null !== f) {
      if (null !== e) {
        var g = e.next;
        e.next = f.next;
        f.next = g;
      }
      d.baseQueue = e = f;
      c.pending = null;
    }
    if (null !== e) {
      f = e.next;
      d = d.baseState;
      var h = g = null, k = null, l = f;
      do {
        var m = l.lane;
        if ((Hh & m) === m) null !== k && (k = k.next = { lane: 0, action: l.action, hasEagerState: l.hasEagerState, eagerState: l.eagerState, next: null }), d = l.hasEagerState ? l.eagerState : a(d, l.action);
        else {
          var q = {
            lane: m,
            action: l.action,
            hasEagerState: l.hasEagerState,
            eagerState: l.eagerState,
            next: null
          };
          null === k ? (h = k = q, g = d) : k = k.next = q;
          M.lanes |= m;
          rh |= m;
        }
        l = l.next;
      } while (null !== l && l !== f);
      null === k ? g = d : k.next = h;
      He(d, b.memoizedState) || (dh = true);
      b.memoizedState = d;
      b.baseState = g;
      b.baseQueue = k;
      c.lastRenderedState = d;
    }
    a = c.interleaved;
    if (null !== a) {
      e = a;
      do
        f = e.lane, M.lanes |= f, rh |= f, e = e.next;
      while (e !== a);
    } else null === e && (c.lanes = 0);
    return [b.memoizedState, c.dispatch];
  }
  function Xh(a) {
    var b = Uh(), c = b.queue;
    if (null === c) throw Error(p(311));
    c.lastRenderedReducer = a;
    var d = c.dispatch, e = c.pending, f = b.memoizedState;
    if (null !== e) {
      c.pending = null;
      var g = e = e.next;
      do
        f = a(f, g.action), g = g.next;
      while (g !== e);
      He(f, b.memoizedState) || (dh = true);
      b.memoizedState = f;
      null === b.baseQueue && (b.baseState = f);
      c.lastRenderedState = f;
    }
    return [f, d];
  }
  function Yh() {
  }
  function Zh(a, b) {
    var c = M, d = Uh(), e = b(), f = !He(d.memoizedState, e);
    f && (d.memoizedState = e, dh = true);
    d = d.queue;
    $h(ai.bind(null, c, d, a), [a]);
    if (d.getSnapshot !== b || f || null !== O && O.memoizedState.tag & 1) {
      c.flags |= 2048;
      bi(9, ci.bind(null, c, d, e, b), void 0, null);
      if (null === Q) throw Error(p(349));
      0 !== (Hh & 30) || di(c, b, e);
    }
    return e;
  }
  function di(a, b, c) {
    a.flags |= 16384;
    a = { getSnapshot: b, value: c };
    b = M.updateQueue;
    null === b ? (b = { lastEffect: null, stores: null }, M.updateQueue = b, b.stores = [a]) : (c = b.stores, null === c ? b.stores = [a] : c.push(a));
  }
  function ci(a, b, c, d) {
    b.value = c;
    b.getSnapshot = d;
    ei(b) && fi(a);
  }
  function ai(a, b, c) {
    return c(function() {
      ei(b) && fi(a);
    });
  }
  function ei(a) {
    var b = a.getSnapshot;
    a = a.value;
    try {
      var c = b();
      return !He(a, c);
    } catch (d) {
      return true;
    }
  }
  function fi(a) {
    var b = ih(a, 1);
    null !== b && gi(b, a, 1, -1);
  }
  function hi(a) {
    var b = Th();
    "function" === typeof a && (a = a());
    b.memoizedState = b.baseState = a;
    a = { pending: null, interleaved: null, lanes: 0, dispatch: null, lastRenderedReducer: Vh, lastRenderedState: a };
    b.queue = a;
    a = a.dispatch = ii.bind(null, M, a);
    return [b.memoizedState, a];
  }
  function bi(a, b, c, d) {
    a = { tag: a, create: b, destroy: c, deps: d, next: null };
    b = M.updateQueue;
    null === b ? (b = { lastEffect: null, stores: null }, M.updateQueue = b, b.lastEffect = a.next = a) : (c = b.lastEffect, null === c ? b.lastEffect = a.next = a : (d = c.next, c.next = a, a.next = d, b.lastEffect = a));
    return a;
  }
  function ji() {
    return Uh().memoizedState;
  }
  function ki(a, b, c, d) {
    var e = Th();
    M.flags |= a;
    e.memoizedState = bi(1 | b, c, void 0, void 0 === d ? null : d);
  }
  function li(a, b, c, d) {
    var e = Uh();
    d = void 0 === d ? null : d;
    var f = void 0;
    if (null !== N) {
      var g = N.memoizedState;
      f = g.destroy;
      if (null !== d && Mh(d, g.deps)) {
        e.memoizedState = bi(b, c, f, d);
        return;
      }
    }
    M.flags |= a;
    e.memoizedState = bi(1 | b, c, f, d);
  }
  function mi(a, b) {
    return ki(8390656, 8, a, b);
  }
  function $h(a, b) {
    return li(2048, 8, a, b);
  }
  function ni(a, b) {
    return li(4, 2, a, b);
  }
  function oi(a, b) {
    return li(4, 4, a, b);
  }
  function pi(a, b) {
    if ("function" === typeof b) return a = a(), b(a), function() {
      b(null);
    };
    if (null !== b && void 0 !== b) return a = a(), b.current = a, function() {
      b.current = null;
    };
  }
  function qi(a, b, c) {
    c = null !== c && void 0 !== c ? c.concat([a]) : null;
    return li(4, 4, pi.bind(null, b, a), c);
  }
  function ri() {
  }
  function si(a, b) {
    var c = Uh();
    b = void 0 === b ? null : b;
    var d = c.memoizedState;
    if (null !== d && null !== b && Mh(b, d[1])) return d[0];
    c.memoizedState = [a, b];
    return a;
  }
  function ti(a, b) {
    var c = Uh();
    b = void 0 === b ? null : b;
    var d = c.memoizedState;
    if (null !== d && null !== b && Mh(b, d[1])) return d[0];
    a = a();
    c.memoizedState = [a, b];
    return a;
  }
  function ui(a, b, c) {
    if (0 === (Hh & 21)) return a.baseState && (a.baseState = false, dh = true), a.memoizedState = c;
    He(c, b) || (c = yc(), M.lanes |= c, rh |= c, a.baseState = true);
    return b;
  }
  function vi(a, b) {
    var c = C;
    C = 0 !== c && 4 > c ? c : 4;
    a(true);
    var d = Gh.transition;
    Gh.transition = {};
    try {
      a(false), b();
    } finally {
      C = c, Gh.transition = d;
    }
  }
  function wi() {
    return Uh().memoizedState;
  }
  function xi(a, b, c) {
    var d = yi(a);
    c = { lane: d, action: c, hasEagerState: false, eagerState: null, next: null };
    if (zi(a)) Ai(b, c);
    else if (c = hh(a, b, c, d), null !== c) {
      var e = R();
      gi(c, a, d, e);
      Bi(c, b, d);
    }
  }
  function ii(a, b, c) {
    var d = yi(a), e = { lane: d, action: c, hasEagerState: false, eagerState: null, next: null };
    if (zi(a)) Ai(b, e);
    else {
      var f = a.alternate;
      if (0 === a.lanes && (null === f || 0 === f.lanes) && (f = b.lastRenderedReducer, null !== f)) try {
        var g = b.lastRenderedState, h = f(g, c);
        e.hasEagerState = true;
        e.eagerState = h;
        if (He(h, g)) {
          var k = b.interleaved;
          null === k ? (e.next = e, gh(b)) : (e.next = k.next, k.next = e);
          b.interleaved = e;
          return;
        }
      } catch (l) {
      } finally {
      }
      c = hh(a, b, e, d);
      null !== c && (e = R(), gi(c, a, d, e), Bi(c, b, d));
    }
  }
  function zi(a) {
    var b = a.alternate;
    return a === M || null !== b && b === M;
  }
  function Ai(a, b) {
    Jh = Ih = true;
    var c = a.pending;
    null === c ? b.next = b : (b.next = c.next, c.next = b);
    a.pending = b;
  }
  function Bi(a, b, c) {
    if (0 !== (c & 4194240)) {
      var d = b.lanes;
      d &= a.pendingLanes;
      c |= d;
      b.lanes = c;
      Cc(a, c);
    }
  }
  var Rh = { readContext: eh, useCallback: P, useContext: P, useEffect: P, useImperativeHandle: P, useInsertionEffect: P, useLayoutEffect: P, useMemo: P, useReducer: P, useRef: P, useState: P, useDebugValue: P, useDeferredValue: P, useTransition: P, useMutableSource: P, useSyncExternalStore: P, useId: P, unstable_isNewReconciler: false }, Oh = { readContext: eh, useCallback: function(a, b) {
    Th().memoizedState = [a, void 0 === b ? null : b];
    return a;
  }, useContext: eh, useEffect: mi, useImperativeHandle: function(a, b, c) {
    c = null !== c && void 0 !== c ? c.concat([a]) : null;
    return ki(
      4194308,
      4,
      pi.bind(null, b, a),
      c
    );
  }, useLayoutEffect: function(a, b) {
    return ki(4194308, 4, a, b);
  }, useInsertionEffect: function(a, b) {
    return ki(4, 2, a, b);
  }, useMemo: function(a, b) {
    var c = Th();
    b = void 0 === b ? null : b;
    a = a();
    c.memoizedState = [a, b];
    return a;
  }, useReducer: function(a, b, c) {
    var d = Th();
    b = void 0 !== c ? c(b) : b;
    d.memoizedState = d.baseState = b;
    a = { pending: null, interleaved: null, lanes: 0, dispatch: null, lastRenderedReducer: a, lastRenderedState: b };
    d.queue = a;
    a = a.dispatch = xi.bind(null, M, a);
    return [d.memoizedState, a];
  }, useRef: function(a) {
    var b = Th();
    a = { current: a };
    return b.memoizedState = a;
  }, useState: hi, useDebugValue: ri, useDeferredValue: function(a) {
    return Th().memoizedState = a;
  }, useTransition: function() {
    var a = hi(false), b = a[0];
    a = vi.bind(null, a[1]);
    Th().memoizedState = a;
    return [b, a];
  }, useMutableSource: function() {
  }, useSyncExternalStore: function(a, b, c) {
    var d = M, e = Th();
    if (I) {
      if (void 0 === c) throw Error(p(407));
      c = c();
    } else {
      c = b();
      if (null === Q) throw Error(p(349));
      0 !== (Hh & 30) || di(d, b, c);
    }
    e.memoizedState = c;
    var f = { value: c, getSnapshot: b };
    e.queue = f;
    mi(ai.bind(
      null,
      d,
      f,
      a
    ), [a]);
    d.flags |= 2048;
    bi(9, ci.bind(null, d, f, c, b), void 0, null);
    return c;
  }, useId: function() {
    var a = Th(), b = Q.identifierPrefix;
    if (I) {
      var c = sg;
      var d = rg;
      c = (d & ~(1 << 32 - oc(d) - 1)).toString(32) + c;
      b = ":" + b + "R" + c;
      c = Kh++;
      0 < c && (b += "H" + c.toString(32));
      b += ":";
    } else c = Lh++, b = ":" + b + "r" + c.toString(32) + ":";
    return a.memoizedState = b;
  }, unstable_isNewReconciler: false }, Ph = {
    readContext: eh,
    useCallback: si,
    useContext: eh,
    useEffect: $h,
    useImperativeHandle: qi,
    useInsertionEffect: ni,
    useLayoutEffect: oi,
    useMemo: ti,
    useReducer: Wh,
    useRef: ji,
    useState: function() {
      return Wh(Vh);
    },
    useDebugValue: ri,
    useDeferredValue: function(a) {
      var b = Uh();
      return ui(b, N.memoizedState, a);
    },
    useTransition: function() {
      var a = Wh(Vh)[0], b = Uh().memoizedState;
      return [a, b];
    },
    useMutableSource: Yh,
    useSyncExternalStore: Zh,
    useId: wi,
    unstable_isNewReconciler: false
  }, Qh = { readContext: eh, useCallback: si, useContext: eh, useEffect: $h, useImperativeHandle: qi, useInsertionEffect: ni, useLayoutEffect: oi, useMemo: ti, useReducer: Xh, useRef: ji, useState: function() {
    return Xh(Vh);
  }, useDebugValue: ri, useDeferredValue: function(a) {
    var b = Uh();
    return null === N ? b.memoizedState = a : ui(b, N.memoizedState, a);
  }, useTransition: function() {
    var a = Xh(Vh)[0], b = Uh().memoizedState;
    return [a, b];
  }, useMutableSource: Yh, useSyncExternalStore: Zh, useId: wi, unstable_isNewReconciler: false };
  function Ci(a, b) {
    if (a && a.defaultProps) {
      b = A({}, b);
      a = a.defaultProps;
      for (var c in a) void 0 === b[c] && (b[c] = a[c]);
      return b;
    }
    return b;
  }
  function Di(a, b, c, d) {
    b = a.memoizedState;
    c = c(d, b);
    c = null === c || void 0 === c ? b : A({}, b, c);
    a.memoizedState = c;
    0 === a.lanes && (a.updateQueue.baseState = c);
  }
  var Ei = { isMounted: function(a) {
    return (a = a._reactInternals) ? Vb(a) === a : false;
  }, enqueueSetState: function(a, b, c) {
    a = a._reactInternals;
    var d = R(), e = yi(a), f = mh(d, e);
    f.payload = b;
    void 0 !== c && null !== c && (f.callback = c);
    b = nh(a, f, e);
    null !== b && (gi(b, a, e, d), oh(b, a, e));
  }, enqueueReplaceState: function(a, b, c) {
    a = a._reactInternals;
    var d = R(), e = yi(a), f = mh(d, e);
    f.tag = 1;
    f.payload = b;
    void 0 !== c && null !== c && (f.callback = c);
    b = nh(a, f, e);
    null !== b && (gi(b, a, e, d), oh(b, a, e));
  }, enqueueForceUpdate: function(a, b) {
    a = a._reactInternals;
    var c = R(), d = yi(a), e = mh(c, d);
    e.tag = 2;
    void 0 !== b && null !== b && (e.callback = b);
    b = nh(a, e, d);
    null !== b && (gi(b, a, d, c), oh(b, a, d));
  } };
  function Fi(a, b, c, d, e, f, g) {
    a = a.stateNode;
    return "function" === typeof a.shouldComponentUpdate ? a.shouldComponentUpdate(d, f, g) : b.prototype && b.prototype.isPureReactComponent ? !Ie(c, d) || !Ie(e, f) : true;
  }
  function Gi(a, b, c) {
    var d = false, e = Vf;
    var f = b.contextType;
    "object" === typeof f && null !== f ? f = eh(f) : (e = Zf(b) ? Xf : H.current, d = b.contextTypes, f = (d = null !== d && void 0 !== d) ? Yf(a, e) : Vf);
    b = new b(c, f);
    a.memoizedState = null !== b.state && void 0 !== b.state ? b.state : null;
    b.updater = Ei;
    a.stateNode = b;
    b._reactInternals = a;
    d && (a = a.stateNode, a.__reactInternalMemoizedUnmaskedChildContext = e, a.__reactInternalMemoizedMaskedChildContext = f);
    return b;
  }
  function Hi(a, b, c, d) {
    a = b.state;
    "function" === typeof b.componentWillReceiveProps && b.componentWillReceiveProps(c, d);
    "function" === typeof b.UNSAFE_componentWillReceiveProps && b.UNSAFE_componentWillReceiveProps(c, d);
    b.state !== a && Ei.enqueueReplaceState(b, b.state, null);
  }
  function Ii(a, b, c, d) {
    var e = a.stateNode;
    e.props = c;
    e.state = a.memoizedState;
    e.refs = {};
    kh(a);
    var f = b.contextType;
    "object" === typeof f && null !== f ? e.context = eh(f) : (f = Zf(b) ? Xf : H.current, e.context = Yf(a, f));
    e.state = a.memoizedState;
    f = b.getDerivedStateFromProps;
    "function" === typeof f && (Di(a, b, f, c), e.state = a.memoizedState);
    "function" === typeof b.getDerivedStateFromProps || "function" === typeof e.getSnapshotBeforeUpdate || "function" !== typeof e.UNSAFE_componentWillMount && "function" !== typeof e.componentWillMount || (b = e.state, "function" === typeof e.componentWillMount && e.componentWillMount(), "function" === typeof e.UNSAFE_componentWillMount && e.UNSAFE_componentWillMount(), b !== e.state && Ei.enqueueReplaceState(e, e.state, null), qh(a, c, e, d), e.state = a.memoizedState);
    "function" === typeof e.componentDidMount && (a.flags |= 4194308);
  }
  function Ji(a, b) {
    try {
      var c = "", d = b;
      do
        c += Pa(d), d = d.return;
      while (d);
      var e = c;
    } catch (f) {
      e = "\nError generating stack: " + f.message + "\n" + f.stack;
    }
    return { value: a, source: b, stack: e, digest: null };
  }
  function Ki(a, b, c) {
    return { value: a, source: null, stack: null != c ? c : null, digest: null != b ? b : null };
  }
  function Li(a, b) {
    try {
      console.error(b.value);
    } catch (c) {
      setTimeout(function() {
        throw c;
      });
    }
  }
  var Mi = "function" === typeof WeakMap ? WeakMap : Map;
  function Ni(a, b, c) {
    c = mh(-1, c);
    c.tag = 3;
    c.payload = { element: null };
    var d = b.value;
    c.callback = function() {
      Oi || (Oi = true, Pi = d);
      Li(a, b);
    };
    return c;
  }
  function Qi(a, b, c) {
    c = mh(-1, c);
    c.tag = 3;
    var d = a.type.getDerivedStateFromError;
    if ("function" === typeof d) {
      var e = b.value;
      c.payload = function() {
        return d(e);
      };
      c.callback = function() {
        Li(a, b);
      };
    }
    var f = a.stateNode;
    null !== f && "function" === typeof f.componentDidCatch && (c.callback = function() {
      Li(a, b);
      "function" !== typeof d && (null === Ri ? Ri = /* @__PURE__ */ new Set([this]) : Ri.add(this));
      var c2 = b.stack;
      this.componentDidCatch(b.value, { componentStack: null !== c2 ? c2 : "" });
    });
    return c;
  }
  function Si(a, b, c) {
    var d = a.pingCache;
    if (null === d) {
      d = a.pingCache = new Mi();
      var e = /* @__PURE__ */ new Set();
      d.set(b, e);
    } else e = d.get(b), void 0 === e && (e = /* @__PURE__ */ new Set(), d.set(b, e));
    e.has(c) || (e.add(c), a = Ti.bind(null, a, b, c), b.then(a, a));
  }
  function Ui(a) {
    do {
      var b;
      if (b = 13 === a.tag) b = a.memoizedState, b = null !== b ? null !== b.dehydrated ? true : false : true;
      if (b) return a;
      a = a.return;
    } while (null !== a);
    return null;
  }
  function Vi(a, b, c, d, e) {
    if (0 === (a.mode & 1)) return a === b ? a.flags |= 65536 : (a.flags |= 128, c.flags |= 131072, c.flags &= -52805, 1 === c.tag && (null === c.alternate ? c.tag = 17 : (b = mh(-1, 1), b.tag = 2, nh(c, b, 1))), c.lanes |= 1), a;
    a.flags |= 65536;
    a.lanes = e;
    return a;
  }
  var Wi = ua.ReactCurrentOwner, dh = false;
  function Xi(a, b, c, d) {
    b.child = null === a ? Vg(b, null, c, d) : Ug(b, a.child, c, d);
  }
  function Yi(a, b, c, d, e) {
    c = c.render;
    var f = b.ref;
    ch(b, e);
    d = Nh(a, b, c, d, f, e);
    c = Sh();
    if (null !== a && !dh) return b.updateQueue = a.updateQueue, b.flags &= -2053, a.lanes &= ~e, Zi(a, b, e);
    I && c && vg(b);
    b.flags |= 1;
    Xi(a, b, d, e);
    return b.child;
  }
  function $i(a, b, c, d, e) {
    if (null === a) {
      var f = c.type;
      if ("function" === typeof f && !aj(f) && void 0 === f.defaultProps && null === c.compare && void 0 === c.defaultProps) return b.tag = 15, b.type = f, bj(a, b, f, d, e);
      a = Rg(c.type, null, d, b, b.mode, e);
      a.ref = b.ref;
      a.return = b;
      return b.child = a;
    }
    f = a.child;
    if (0 === (a.lanes & e)) {
      var g = f.memoizedProps;
      c = c.compare;
      c = null !== c ? c : Ie;
      if (c(g, d) && a.ref === b.ref) return Zi(a, b, e);
    }
    b.flags |= 1;
    a = Pg(f, d);
    a.ref = b.ref;
    a.return = b;
    return b.child = a;
  }
  function bj(a, b, c, d, e) {
    if (null !== a) {
      var f = a.memoizedProps;
      if (Ie(f, d) && a.ref === b.ref) if (dh = false, b.pendingProps = d = f, 0 !== (a.lanes & e)) 0 !== (a.flags & 131072) && (dh = true);
      else return b.lanes = a.lanes, Zi(a, b, e);
    }
    return cj(a, b, c, d, e);
  }
  function dj(a, b, c) {
    var d = b.pendingProps, e = d.children, f = null !== a ? a.memoizedState : null;
    if ("hidden" === d.mode) if (0 === (b.mode & 1)) b.memoizedState = { baseLanes: 0, cachePool: null, transitions: null }, G(ej, fj), fj |= c;
    else {
      if (0 === (c & 1073741824)) return a = null !== f ? f.baseLanes | c : c, b.lanes = b.childLanes = 1073741824, b.memoizedState = { baseLanes: a, cachePool: null, transitions: null }, b.updateQueue = null, G(ej, fj), fj |= a, null;
      b.memoizedState = { baseLanes: 0, cachePool: null, transitions: null };
      d = null !== f ? f.baseLanes : c;
      G(ej, fj);
      fj |= d;
    }
    else null !== f ? (d = f.baseLanes | c, b.memoizedState = null) : d = c, G(ej, fj), fj |= d;
    Xi(a, b, e, c);
    return b.child;
  }
  function gj(a, b) {
    var c = b.ref;
    if (null === a && null !== c || null !== a && a.ref !== c) b.flags |= 512, b.flags |= 2097152;
  }
  function cj(a, b, c, d, e) {
    var f = Zf(c) ? Xf : H.current;
    f = Yf(b, f);
    ch(b, e);
    c = Nh(a, b, c, d, f, e);
    d = Sh();
    if (null !== a && !dh) return b.updateQueue = a.updateQueue, b.flags &= -2053, a.lanes &= ~e, Zi(a, b, e);
    I && d && vg(b);
    b.flags |= 1;
    Xi(a, b, c, e);
    return b.child;
  }
  function hj(a, b, c, d, e) {
    if (Zf(c)) {
      var f = true;
      cg(b);
    } else f = false;
    ch(b, e);
    if (null === b.stateNode) ij(a, b), Gi(b, c, d), Ii(b, c, d, e), d = true;
    else if (null === a) {
      var g = b.stateNode, h = b.memoizedProps;
      g.props = h;
      var k = g.context, l = c.contextType;
      "object" === typeof l && null !== l ? l = eh(l) : (l = Zf(c) ? Xf : H.current, l = Yf(b, l));
      var m = c.getDerivedStateFromProps, q = "function" === typeof m || "function" === typeof g.getSnapshotBeforeUpdate;
      q || "function" !== typeof g.UNSAFE_componentWillReceiveProps && "function" !== typeof g.componentWillReceiveProps || (h !== d || k !== l) && Hi(b, g, d, l);
      jh = false;
      var r = b.memoizedState;
      g.state = r;
      qh(b, d, g, e);
      k = b.memoizedState;
      h !== d || r !== k || Wf.current || jh ? ("function" === typeof m && (Di(b, c, m, d), k = b.memoizedState), (h = jh || Fi(b, c, h, d, r, k, l)) ? (q || "function" !== typeof g.UNSAFE_componentWillMount && "function" !== typeof g.componentWillMount || ("function" === typeof g.componentWillMount && g.componentWillMount(), "function" === typeof g.UNSAFE_componentWillMount && g.UNSAFE_componentWillMount()), "function" === typeof g.componentDidMount && (b.flags |= 4194308)) : ("function" === typeof g.componentDidMount && (b.flags |= 4194308), b.memoizedProps = d, b.memoizedState = k), g.props = d, g.state = k, g.context = l, d = h) : ("function" === typeof g.componentDidMount && (b.flags |= 4194308), d = false);
    } else {
      g = b.stateNode;
      lh(a, b);
      h = b.memoizedProps;
      l = b.type === b.elementType ? h : Ci(b.type, h);
      g.props = l;
      q = b.pendingProps;
      r = g.context;
      k = c.contextType;
      "object" === typeof k && null !== k ? k = eh(k) : (k = Zf(c) ? Xf : H.current, k = Yf(b, k));
      var y = c.getDerivedStateFromProps;
      (m = "function" === typeof y || "function" === typeof g.getSnapshotBeforeUpdate) || "function" !== typeof g.UNSAFE_componentWillReceiveProps && "function" !== typeof g.componentWillReceiveProps || (h !== q || r !== k) && Hi(b, g, d, k);
      jh = false;
      r = b.memoizedState;
      g.state = r;
      qh(b, d, g, e);
      var n = b.memoizedState;
      h !== q || r !== n || Wf.current || jh ? ("function" === typeof y && (Di(b, c, y, d), n = b.memoizedState), (l = jh || Fi(b, c, l, d, r, n, k) || false) ? (m || "function" !== typeof g.UNSAFE_componentWillUpdate && "function" !== typeof g.componentWillUpdate || ("function" === typeof g.componentWillUpdate && g.componentWillUpdate(d, n, k), "function" === typeof g.UNSAFE_componentWillUpdate && g.UNSAFE_componentWillUpdate(d, n, k)), "function" === typeof g.componentDidUpdate && (b.flags |= 4), "function" === typeof g.getSnapshotBeforeUpdate && (b.flags |= 1024)) : ("function" !== typeof g.componentDidUpdate || h === a.memoizedProps && r === a.memoizedState || (b.flags |= 4), "function" !== typeof g.getSnapshotBeforeUpdate || h === a.memoizedProps && r === a.memoizedState || (b.flags |= 1024), b.memoizedProps = d, b.memoizedState = n), g.props = d, g.state = n, g.context = k, d = l) : ("function" !== typeof g.componentDidUpdate || h === a.memoizedProps && r === a.memoizedState || (b.flags |= 4), "function" !== typeof g.getSnapshotBeforeUpdate || h === a.memoizedProps && r === a.memoizedState || (b.flags |= 1024), d = false);
    }
    return jj(a, b, c, d, f, e);
  }
  function jj(a, b, c, d, e, f) {
    gj(a, b);
    var g = 0 !== (b.flags & 128);
    if (!d && !g) return e && dg(b, c, false), Zi(a, b, f);
    d = b.stateNode;
    Wi.current = b;
    var h = g && "function" !== typeof c.getDerivedStateFromError ? null : d.render();
    b.flags |= 1;
    null !== a && g ? (b.child = Ug(b, a.child, null, f), b.child = Ug(b, null, h, f)) : Xi(a, b, h, f);
    b.memoizedState = d.state;
    e && dg(b, c, true);
    return b.child;
  }
  function kj(a) {
    var b = a.stateNode;
    b.pendingContext ? ag(a, b.pendingContext, b.pendingContext !== b.context) : b.context && ag(a, b.context, false);
    yh(a, b.containerInfo);
  }
  function lj(a, b, c, d, e) {
    Ig();
    Jg(e);
    b.flags |= 256;
    Xi(a, b, c, d);
    return b.child;
  }
  var mj = { dehydrated: null, treeContext: null, retryLane: 0 };
  function nj(a) {
    return { baseLanes: a, cachePool: null, transitions: null };
  }
  function oj(a, b, c) {
    var d = b.pendingProps, e = L.current, f = false, g = 0 !== (b.flags & 128), h;
    (h = g) || (h = null !== a && null === a.memoizedState ? false : 0 !== (e & 2));
    if (h) f = true, b.flags &= -129;
    else if (null === a || null !== a.memoizedState) e |= 1;
    G(L, e & 1);
    if (null === a) {
      Eg(b);
      a = b.memoizedState;
      if (null !== a && (a = a.dehydrated, null !== a)) return 0 === (b.mode & 1) ? b.lanes = 1 : "$!" === a.data ? b.lanes = 8 : b.lanes = 1073741824, null;
      g = d.children;
      a = d.fallback;
      return f ? (d = b.mode, f = b.child, g = { mode: "hidden", children: g }, 0 === (d & 1) && null !== f ? (f.childLanes = 0, f.pendingProps = g) : f = pj(g, d, 0, null), a = Tg(a, d, c, null), f.return = b, a.return = b, f.sibling = a, b.child = f, b.child.memoizedState = nj(c), b.memoizedState = mj, a) : qj(b, g);
    }
    e = a.memoizedState;
    if (null !== e && (h = e.dehydrated, null !== h)) return rj(a, b, g, d, h, e, c);
    if (f) {
      f = d.fallback;
      g = b.mode;
      e = a.child;
      h = e.sibling;
      var k = { mode: "hidden", children: d.children };
      0 === (g & 1) && b.child !== e ? (d = b.child, d.childLanes = 0, d.pendingProps = k, b.deletions = null) : (d = Pg(e, k), d.subtreeFlags = e.subtreeFlags & 14680064);
      null !== h ? f = Pg(h, f) : (f = Tg(f, g, c, null), f.flags |= 2);
      f.return = b;
      d.return = b;
      d.sibling = f;
      b.child = d;
      d = f;
      f = b.child;
      g = a.child.memoizedState;
      g = null === g ? nj(c) : { baseLanes: g.baseLanes | c, cachePool: null, transitions: g.transitions };
      f.memoizedState = g;
      f.childLanes = a.childLanes & ~c;
      b.memoizedState = mj;
      return d;
    }
    f = a.child;
    a = f.sibling;
    d = Pg(f, { mode: "visible", children: d.children });
    0 === (b.mode & 1) && (d.lanes = c);
    d.return = b;
    d.sibling = null;
    null !== a && (c = b.deletions, null === c ? (b.deletions = [a], b.flags |= 16) : c.push(a));
    b.child = d;
    b.memoizedState = null;
    return d;
  }
  function qj(a, b) {
    b = pj({ mode: "visible", children: b }, a.mode, 0, null);
    b.return = a;
    return a.child = b;
  }
  function sj(a, b, c, d) {
    null !== d && Jg(d);
    Ug(b, a.child, null, c);
    a = qj(b, b.pendingProps.children);
    a.flags |= 2;
    b.memoizedState = null;
    return a;
  }
  function rj(a, b, c, d, e, f, g) {
    if (c) {
      if (b.flags & 256) return b.flags &= -257, d = Ki(Error(p(422))), sj(a, b, g, d);
      if (null !== b.memoizedState) return b.child = a.child, b.flags |= 128, null;
      f = d.fallback;
      e = b.mode;
      d = pj({ mode: "visible", children: d.children }, e, 0, null);
      f = Tg(f, e, g, null);
      f.flags |= 2;
      d.return = b;
      f.return = b;
      d.sibling = f;
      b.child = d;
      0 !== (b.mode & 1) && Ug(b, a.child, null, g);
      b.child.memoizedState = nj(g);
      b.memoizedState = mj;
      return f;
    }
    if (0 === (b.mode & 1)) return sj(a, b, g, null);
    if ("$!" === e.data) {
      d = e.nextSibling && e.nextSibling.dataset;
      if (d) var h = d.dgst;
      d = h;
      f = Error(p(419));
      d = Ki(f, d, void 0);
      return sj(a, b, g, d);
    }
    h = 0 !== (g & a.childLanes);
    if (dh || h) {
      d = Q;
      if (null !== d) {
        switch (g & -g) {
          case 4:
            e = 2;
            break;
          case 16:
            e = 8;
            break;
          case 64:
          case 128:
          case 256:
          case 512:
          case 1024:
          case 2048:
          case 4096:
          case 8192:
          case 16384:
          case 32768:
          case 65536:
          case 131072:
          case 262144:
          case 524288:
          case 1048576:
          case 2097152:
          case 4194304:
          case 8388608:
          case 16777216:
          case 33554432:
          case 67108864:
            e = 32;
            break;
          case 536870912:
            e = 268435456;
            break;
          default:
            e = 0;
        }
        e = 0 !== (e & (d.suspendedLanes | g)) ? 0 : e;
        0 !== e && e !== f.retryLane && (f.retryLane = e, ih(a, e), gi(d, a, e, -1));
      }
      tj();
      d = Ki(Error(p(421)));
      return sj(a, b, g, d);
    }
    if ("$?" === e.data) return b.flags |= 128, b.child = a.child, b = uj.bind(null, a), e._reactRetry = b, null;
    a = f.treeContext;
    yg = Lf(e.nextSibling);
    xg = b;
    I = true;
    zg = null;
    null !== a && (og[pg++] = rg, og[pg++] = sg, og[pg++] = qg, rg = a.id, sg = a.overflow, qg = b);
    b = qj(b, d.children);
    b.flags |= 4096;
    return b;
  }
  function vj(a, b, c) {
    a.lanes |= b;
    var d = a.alternate;
    null !== d && (d.lanes |= b);
    bh(a.return, b, c);
  }
  function wj(a, b, c, d, e) {
    var f = a.memoizedState;
    null === f ? a.memoizedState = { isBackwards: b, rendering: null, renderingStartTime: 0, last: d, tail: c, tailMode: e } : (f.isBackwards = b, f.rendering = null, f.renderingStartTime = 0, f.last = d, f.tail = c, f.tailMode = e);
  }
  function xj(a, b, c) {
    var d = b.pendingProps, e = d.revealOrder, f = d.tail;
    Xi(a, b, d.children, c);
    d = L.current;
    if (0 !== (d & 2)) d = d & 1 | 2, b.flags |= 128;
    else {
      if (null !== a && 0 !== (a.flags & 128)) a: for (a = b.child; null !== a; ) {
        if (13 === a.tag) null !== a.memoizedState && vj(a, c, b);
        else if (19 === a.tag) vj(a, c, b);
        else if (null !== a.child) {
          a.child.return = a;
          a = a.child;
          continue;
        }
        if (a === b) break a;
        for (; null === a.sibling; ) {
          if (null === a.return || a.return === b) break a;
          a = a.return;
        }
        a.sibling.return = a.return;
        a = a.sibling;
      }
      d &= 1;
    }
    G(L, d);
    if (0 === (b.mode & 1)) b.memoizedState = null;
    else switch (e) {
      case "forwards":
        c = b.child;
        for (e = null; null !== c; ) a = c.alternate, null !== a && null === Ch(a) && (e = c), c = c.sibling;
        c = e;
        null === c ? (e = b.child, b.child = null) : (e = c.sibling, c.sibling = null);
        wj(b, false, e, c, f);
        break;
      case "backwards":
        c = null;
        e = b.child;
        for (b.child = null; null !== e; ) {
          a = e.alternate;
          if (null !== a && null === Ch(a)) {
            b.child = e;
            break;
          }
          a = e.sibling;
          e.sibling = c;
          c = e;
          e = a;
        }
        wj(b, true, c, null, f);
        break;
      case "together":
        wj(b, false, null, null, void 0);
        break;
      default:
        b.memoizedState = null;
    }
    return b.child;
  }
  function ij(a, b) {
    0 === (b.mode & 1) && null !== a && (a.alternate = null, b.alternate = null, b.flags |= 2);
  }
  function Zi(a, b, c) {
    null !== a && (b.dependencies = a.dependencies);
    rh |= b.lanes;
    if (0 === (c & b.childLanes)) return null;
    if (null !== a && b.child !== a.child) throw Error(p(153));
    if (null !== b.child) {
      a = b.child;
      c = Pg(a, a.pendingProps);
      b.child = c;
      for (c.return = b; null !== a.sibling; ) a = a.sibling, c = c.sibling = Pg(a, a.pendingProps), c.return = b;
      c.sibling = null;
    }
    return b.child;
  }
  function yj(a, b, c) {
    switch (b.tag) {
      case 3:
        kj(b);
        Ig();
        break;
      case 5:
        Ah(b);
        break;
      case 1:
        Zf(b.type) && cg(b);
        break;
      case 4:
        yh(b, b.stateNode.containerInfo);
        break;
      case 10:
        var d = b.type._context, e = b.memoizedProps.value;
        G(Wg, d._currentValue);
        d._currentValue = e;
        break;
      case 13:
        d = b.memoizedState;
        if (null !== d) {
          if (null !== d.dehydrated) return G(L, L.current & 1), b.flags |= 128, null;
          if (0 !== (c & b.child.childLanes)) return oj(a, b, c);
          G(L, L.current & 1);
          a = Zi(a, b, c);
          return null !== a ? a.sibling : null;
        }
        G(L, L.current & 1);
        break;
      case 19:
        d = 0 !== (c & b.childLanes);
        if (0 !== (a.flags & 128)) {
          if (d) return xj(a, b, c);
          b.flags |= 128;
        }
        e = b.memoizedState;
        null !== e && (e.rendering = null, e.tail = null, e.lastEffect = null);
        G(L, L.current);
        if (d) break;
        else return null;
      case 22:
      case 23:
        return b.lanes = 0, dj(a, b, c);
    }
    return Zi(a, b, c);
  }
  var zj, Aj, Bj, Cj;
  zj = function(a, b) {
    for (var c = b.child; null !== c; ) {
      if (5 === c.tag || 6 === c.tag) a.appendChild(c.stateNode);
      else if (4 !== c.tag && null !== c.child) {
        c.child.return = c;
        c = c.child;
        continue;
      }
      if (c === b) break;
      for (; null === c.sibling; ) {
        if (null === c.return || c.return === b) return;
        c = c.return;
      }
      c.sibling.return = c.return;
      c = c.sibling;
    }
  };
  Aj = function() {
  };
  Bj = function(a, b, c, d) {
    var e = a.memoizedProps;
    if (e !== d) {
      a = b.stateNode;
      xh(uh.current);
      var f = null;
      switch (c) {
        case "input":
          e = Ya(a, e);
          d = Ya(a, d);
          f = [];
          break;
        case "select":
          e = A({}, e, { value: void 0 });
          d = A({}, d, { value: void 0 });
          f = [];
          break;
        case "textarea":
          e = gb(a, e);
          d = gb(a, d);
          f = [];
          break;
        default:
          "function" !== typeof e.onClick && "function" === typeof d.onClick && (a.onclick = Bf);
      }
      ub(c, d);
      var g;
      c = null;
      for (l in e) if (!d.hasOwnProperty(l) && e.hasOwnProperty(l) && null != e[l]) if ("style" === l) {
        var h = e[l];
        for (g in h) h.hasOwnProperty(g) && (c || (c = {}), c[g] = "");
      } else "dangerouslySetInnerHTML" !== l && "children" !== l && "suppressContentEditableWarning" !== l && "suppressHydrationWarning" !== l && "autoFocus" !== l && (ea.hasOwnProperty(l) ? f || (f = []) : (f = f || []).push(l, null));
      for (l in d) {
        var k = d[l];
        h = null != e ? e[l] : void 0;
        if (d.hasOwnProperty(l) && k !== h && (null != k || null != h)) if ("style" === l) if (h) {
          for (g in h) !h.hasOwnProperty(g) || k && k.hasOwnProperty(g) || (c || (c = {}), c[g] = "");
          for (g in k) k.hasOwnProperty(g) && h[g] !== k[g] && (c || (c = {}), c[g] = k[g]);
        } else c || (f || (f = []), f.push(
          l,
          c
        )), c = k;
        else "dangerouslySetInnerHTML" === l ? (k = k ? k.__html : void 0, h = h ? h.__html : void 0, null != k && h !== k && (f = f || []).push(l, k)) : "children" === l ? "string" !== typeof k && "number" !== typeof k || (f = f || []).push(l, "" + k) : "suppressContentEditableWarning" !== l && "suppressHydrationWarning" !== l && (ea.hasOwnProperty(l) ? (null != k && "onScroll" === l && D("scroll", a), f || h === k || (f = [])) : (f = f || []).push(l, k));
      }
      c && (f = f || []).push("style", c);
      var l = f;
      if (b.updateQueue = l) b.flags |= 4;
    }
  };
  Cj = function(a, b, c, d) {
    c !== d && (b.flags |= 4);
  };
  function Dj(a, b) {
    if (!I) switch (a.tailMode) {
      case "hidden":
        b = a.tail;
        for (var c = null; null !== b; ) null !== b.alternate && (c = b), b = b.sibling;
        null === c ? a.tail = null : c.sibling = null;
        break;
      case "collapsed":
        c = a.tail;
        for (var d = null; null !== c; ) null !== c.alternate && (d = c), c = c.sibling;
        null === d ? b || null === a.tail ? a.tail = null : a.tail.sibling = null : d.sibling = null;
    }
  }
  function S(a) {
    var b = null !== a.alternate && a.alternate.child === a.child, c = 0, d = 0;
    if (b) for (var e = a.child; null !== e; ) c |= e.lanes | e.childLanes, d |= e.subtreeFlags & 14680064, d |= e.flags & 14680064, e.return = a, e = e.sibling;
    else for (e = a.child; null !== e; ) c |= e.lanes | e.childLanes, d |= e.subtreeFlags, d |= e.flags, e.return = a, e = e.sibling;
    a.subtreeFlags |= d;
    a.childLanes = c;
    return b;
  }
  function Ej(a, b, c) {
    var d = b.pendingProps;
    wg(b);
    switch (b.tag) {
      case 2:
      case 16:
      case 15:
      case 0:
      case 11:
      case 7:
      case 8:
      case 12:
      case 9:
      case 14:
        return S(b), null;
      case 1:
        return Zf(b.type) && $f(), S(b), null;
      case 3:
        d = b.stateNode;
        zh();
        E(Wf);
        E(H);
        Eh();
        d.pendingContext && (d.context = d.pendingContext, d.pendingContext = null);
        if (null === a || null === a.child) Gg(b) ? b.flags |= 4 : null === a || a.memoizedState.isDehydrated && 0 === (b.flags & 256) || (b.flags |= 1024, null !== zg && (Fj(zg), zg = null));
        Aj(a, b);
        S(b);
        return null;
      case 5:
        Bh(b);
        var e = xh(wh.current);
        c = b.type;
        if (null !== a && null != b.stateNode) Bj(a, b, c, d, e), a.ref !== b.ref && (b.flags |= 512, b.flags |= 2097152);
        else {
          if (!d) {
            if (null === b.stateNode) throw Error(p(166));
            S(b);
            return null;
          }
          a = xh(uh.current);
          if (Gg(b)) {
            d = b.stateNode;
            c = b.type;
            var f = b.memoizedProps;
            d[Of] = b;
            d[Pf] = f;
            a = 0 !== (b.mode & 1);
            switch (c) {
              case "dialog":
                D("cancel", d);
                D("close", d);
                break;
              case "iframe":
              case "object":
              case "embed":
                D("load", d);
                break;
              case "video":
              case "audio":
                for (e = 0; e < lf.length; e++) D(lf[e], d);
                break;
              case "source":
                D("error", d);
                break;
              case "img":
              case "image":
              case "link":
                D(
                  "error",
                  d
                );
                D("load", d);
                break;
              case "details":
                D("toggle", d);
                break;
              case "input":
                Za(d, f);
                D("invalid", d);
                break;
              case "select":
                d._wrapperState = { wasMultiple: !!f.multiple };
                D("invalid", d);
                break;
              case "textarea":
                hb(d, f), D("invalid", d);
            }
            ub(c, f);
            e = null;
            for (var g in f) if (f.hasOwnProperty(g)) {
              var h = f[g];
              "children" === g ? "string" === typeof h ? d.textContent !== h && (true !== f.suppressHydrationWarning && Af(d.textContent, h, a), e = ["children", h]) : "number" === typeof h && d.textContent !== "" + h && (true !== f.suppressHydrationWarning && Af(
                d.textContent,
                h,
                a
              ), e = ["children", "" + h]) : ea.hasOwnProperty(g) && null != h && "onScroll" === g && D("scroll", d);
            }
            switch (c) {
              case "input":
                Va(d);
                db(d, f, true);
                break;
              case "textarea":
                Va(d);
                jb(d);
                break;
              case "select":
              case "option":
                break;
              default:
                "function" === typeof f.onClick && (d.onclick = Bf);
            }
            d = e;
            b.updateQueue = d;
            null !== d && (b.flags |= 4);
          } else {
            g = 9 === e.nodeType ? e : e.ownerDocument;
            "http://www.w3.org/1999/xhtml" === a && (a = kb(c));
            "http://www.w3.org/1999/xhtml" === a ? "script" === c ? (a = g.createElement("div"), a.innerHTML = "<script><\/script>", a = a.removeChild(a.firstChild)) : "string" === typeof d.is ? a = g.createElement(c, { is: d.is }) : (a = g.createElement(c), "select" === c && (g = a, d.multiple ? g.multiple = true : d.size && (g.size = d.size))) : a = g.createElementNS(a, c);
            a[Of] = b;
            a[Pf] = d;
            zj(a, b, false, false);
            b.stateNode = a;
            a: {
              g = vb(c, d);
              switch (c) {
                case "dialog":
                  D("cancel", a);
                  D("close", a);
                  e = d;
                  break;
                case "iframe":
                case "object":
                case "embed":
                  D("load", a);
                  e = d;
                  break;
                case "video":
                case "audio":
                  for (e = 0; e < lf.length; e++) D(lf[e], a);
                  e = d;
                  break;
                case "source":
                  D("error", a);
                  e = d;
                  break;
                case "img":
                case "image":
                case "link":
                  D(
                    "error",
                    a
                  );
                  D("load", a);
                  e = d;
                  break;
                case "details":
                  D("toggle", a);
                  e = d;
                  break;
                case "input":
                  Za(a, d);
                  e = Ya(a, d);
                  D("invalid", a);
                  break;
                case "option":
                  e = d;
                  break;
                case "select":
                  a._wrapperState = { wasMultiple: !!d.multiple };
                  e = A({}, d, { value: void 0 });
                  D("invalid", a);
                  break;
                case "textarea":
                  hb(a, d);
                  e = gb(a, d);
                  D("invalid", a);
                  break;
                default:
                  e = d;
              }
              ub(c, e);
              h = e;
              for (f in h) if (h.hasOwnProperty(f)) {
                var k = h[f];
                "style" === f ? sb(a, k) : "dangerouslySetInnerHTML" === f ? (k = k ? k.__html : void 0, null != k && nb(a, k)) : "children" === f ? "string" === typeof k ? ("textarea" !== c || "" !== k) && ob(a, k) : "number" === typeof k && ob(a, "" + k) : "suppressContentEditableWarning" !== f && "suppressHydrationWarning" !== f && "autoFocus" !== f && (ea.hasOwnProperty(f) ? null != k && "onScroll" === f && D("scroll", a) : null != k && ta(a, f, k, g));
              }
              switch (c) {
                case "input":
                  Va(a);
                  db(a, d, false);
                  break;
                case "textarea":
                  Va(a);
                  jb(a);
                  break;
                case "option":
                  null != d.value && a.setAttribute("value", "" + Sa(d.value));
                  break;
                case "select":
                  a.multiple = !!d.multiple;
                  f = d.value;
                  null != f ? fb(a, !!d.multiple, f, false) : null != d.defaultValue && fb(
                    a,
                    !!d.multiple,
                    d.defaultValue,
                    true
                  );
                  break;
                default:
                  "function" === typeof e.onClick && (a.onclick = Bf);
              }
              switch (c) {
                case "button":
                case "input":
                case "select":
                case "textarea":
                  d = !!d.autoFocus;
                  break a;
                case "img":
                  d = true;
                  break a;
                default:
                  d = false;
              }
            }
            d && (b.flags |= 4);
          }
          null !== b.ref && (b.flags |= 512, b.flags |= 2097152);
        }
        S(b);
        return null;
      case 6:
        if (a && null != b.stateNode) Cj(a, b, a.memoizedProps, d);
        else {
          if ("string" !== typeof d && null === b.stateNode) throw Error(p(166));
          c = xh(wh.current);
          xh(uh.current);
          if (Gg(b)) {
            d = b.stateNode;
            c = b.memoizedProps;
            d[Of] = b;
            if (f = d.nodeValue !== c) {
              if (a = xg, null !== a) switch (a.tag) {
                case 3:
                  Af(d.nodeValue, c, 0 !== (a.mode & 1));
                  break;
                case 5:
                  true !== a.memoizedProps.suppressHydrationWarning && Af(d.nodeValue, c, 0 !== (a.mode & 1));
              }
            }
            f && (b.flags |= 4);
          } else d = (9 === c.nodeType ? c : c.ownerDocument).createTextNode(d), d[Of] = b, b.stateNode = d;
        }
        S(b);
        return null;
      case 13:
        E(L);
        d = b.memoizedState;
        if (null === a || null !== a.memoizedState && null !== a.memoizedState.dehydrated) {
          if (I && null !== yg && 0 !== (b.mode & 1) && 0 === (b.flags & 128)) Hg(), Ig(), b.flags |= 98560, f = false;
          else if (f = Gg(b), null !== d && null !== d.dehydrated) {
            if (null === a) {
              if (!f) throw Error(p(318));
              f = b.memoizedState;
              f = null !== f ? f.dehydrated : null;
              if (!f) throw Error(p(317));
              f[Of] = b;
            } else Ig(), 0 === (b.flags & 128) && (b.memoizedState = null), b.flags |= 4;
            S(b);
            f = false;
          } else null !== zg && (Fj(zg), zg = null), f = true;
          if (!f) return b.flags & 65536 ? b : null;
        }
        if (0 !== (b.flags & 128)) return b.lanes = c, b;
        d = null !== d;
        d !== (null !== a && null !== a.memoizedState) && d && (b.child.flags |= 8192, 0 !== (b.mode & 1) && (null === a || 0 !== (L.current & 1) ? 0 === T && (T = 3) : tj()));
        null !== b.updateQueue && (b.flags |= 4);
        S(b);
        return null;
      case 4:
        return zh(), Aj(a, b), null === a && sf(b.stateNode.containerInfo), S(b), null;
      case 10:
        return ah(b.type._context), S(b), null;
      case 17:
        return Zf(b.type) && $f(), S(b), null;
      case 19:
        E(L);
        f = b.memoizedState;
        if (null === f) return S(b), null;
        d = 0 !== (b.flags & 128);
        g = f.rendering;
        if (null === g) if (d) Dj(f, false);
        else {
          if (0 !== T || null !== a && 0 !== (a.flags & 128)) for (a = b.child; null !== a; ) {
            g = Ch(a);
            if (null !== g) {
              b.flags |= 128;
              Dj(f, false);
              d = g.updateQueue;
              null !== d && (b.updateQueue = d, b.flags |= 4);
              b.subtreeFlags = 0;
              d = c;
              for (c = b.child; null !== c; ) f = c, a = d, f.flags &= 14680066, g = f.alternate, null === g ? (f.childLanes = 0, f.lanes = a, f.child = null, f.subtreeFlags = 0, f.memoizedProps = null, f.memoizedState = null, f.updateQueue = null, f.dependencies = null, f.stateNode = null) : (f.childLanes = g.childLanes, f.lanes = g.lanes, f.child = g.child, f.subtreeFlags = 0, f.deletions = null, f.memoizedProps = g.memoizedProps, f.memoizedState = g.memoizedState, f.updateQueue = g.updateQueue, f.type = g.type, a = g.dependencies, f.dependencies = null === a ? null : { lanes: a.lanes, firstContext: a.firstContext }), c = c.sibling;
              G(L, L.current & 1 | 2);
              return b.child;
            }
            a = a.sibling;
          }
          null !== f.tail && B() > Gj && (b.flags |= 128, d = true, Dj(f, false), b.lanes = 4194304);
        }
        else {
          if (!d) if (a = Ch(g), null !== a) {
            if (b.flags |= 128, d = true, c = a.updateQueue, null !== c && (b.updateQueue = c, b.flags |= 4), Dj(f, true), null === f.tail && "hidden" === f.tailMode && !g.alternate && !I) return S(b), null;
          } else 2 * B() - f.renderingStartTime > Gj && 1073741824 !== c && (b.flags |= 128, d = true, Dj(f, false), b.lanes = 4194304);
          f.isBackwards ? (g.sibling = b.child, b.child = g) : (c = f.last, null !== c ? c.sibling = g : b.child = g, f.last = g);
        }
        if (null !== f.tail) return b = f.tail, f.rendering = b, f.tail = b.sibling, f.renderingStartTime = B(), b.sibling = null, c = L.current, G(L, d ? c & 1 | 2 : c & 1), b;
        S(b);
        return null;
      case 22:
      case 23:
        return Hj(), d = null !== b.memoizedState, null !== a && null !== a.memoizedState !== d && (b.flags |= 8192), d && 0 !== (b.mode & 1) ? 0 !== (fj & 1073741824) && (S(b), b.subtreeFlags & 6 && (b.flags |= 8192)) : S(b), null;
      case 24:
        return null;
      case 25:
        return null;
    }
    throw Error(p(156, b.tag));
  }
  function Ij(a, b) {
    wg(b);
    switch (b.tag) {
      case 1:
        return Zf(b.type) && $f(), a = b.flags, a & 65536 ? (b.flags = a & -65537 | 128, b) : null;
      case 3:
        return zh(), E(Wf), E(H), Eh(), a = b.flags, 0 !== (a & 65536) && 0 === (a & 128) ? (b.flags = a & -65537 | 128, b) : null;
      case 5:
        return Bh(b), null;
      case 13:
        E(L);
        a = b.memoizedState;
        if (null !== a && null !== a.dehydrated) {
          if (null === b.alternate) throw Error(p(340));
          Ig();
        }
        a = b.flags;
        return a & 65536 ? (b.flags = a & -65537 | 128, b) : null;
      case 19:
        return E(L), null;
      case 4:
        return zh(), null;
      case 10:
        return ah(b.type._context), null;
      case 22:
      case 23:
        return Hj(), null;
      case 24:
        return null;
      default:
        return null;
    }
  }
  var Jj = false, U = false, Kj = "function" === typeof WeakSet ? WeakSet : Set, V = null;
  function Lj(a, b) {
    var c = a.ref;
    if (null !== c) if ("function" === typeof c) try {
      c(null);
    } catch (d) {
      W2(a, b, d);
    }
    else c.current = null;
  }
  function Mj(a, b, c) {
    try {
      c();
    } catch (d) {
      W2(a, b, d);
    }
  }
  var Nj = false;
  function Oj(a, b) {
    Cf = dd;
    a = Me();
    if (Ne(a)) {
      if ("selectionStart" in a) var c = { start: a.selectionStart, end: a.selectionEnd };
      else a: {
        c = (c = a.ownerDocument) && c.defaultView || window;
        var d = c.getSelection && c.getSelection();
        if (d && 0 !== d.rangeCount) {
          c = d.anchorNode;
          var e = d.anchorOffset, f = d.focusNode;
          d = d.focusOffset;
          try {
            c.nodeType, f.nodeType;
          } catch (F) {
            c = null;
            break a;
          }
          var g = 0, h = -1, k = -1, l = 0, m = 0, q = a, r = null;
          b: for (; ; ) {
            for (var y; ; ) {
              q !== c || 0 !== e && 3 !== q.nodeType || (h = g + e);
              q !== f || 0 !== d && 3 !== q.nodeType || (k = g + d);
              3 === q.nodeType && (g += q.nodeValue.length);
              if (null === (y = q.firstChild)) break;
              r = q;
              q = y;
            }
            for (; ; ) {
              if (q === a) break b;
              r === c && ++l === e && (h = g);
              r === f && ++m === d && (k = g);
              if (null !== (y = q.nextSibling)) break;
              q = r;
              r = q.parentNode;
            }
            q = y;
          }
          c = -1 === h || -1 === k ? null : { start: h, end: k };
        } else c = null;
      }
      c = c || { start: 0, end: 0 };
    } else c = null;
    Df = { focusedElem: a, selectionRange: c };
    dd = false;
    for (V = b; null !== V; ) if (b = V, a = b.child, 0 !== (b.subtreeFlags & 1028) && null !== a) a.return = b, V = a;
    else for (; null !== V; ) {
      b = V;
      try {
        var n = b.alternate;
        if (0 !== (b.flags & 1024)) switch (b.tag) {
          case 0:
          case 11:
          case 15:
            break;
          case 1:
            if (null !== n) {
              var t = n.memoizedProps, J = n.memoizedState, x = b.stateNode, w = x.getSnapshotBeforeUpdate(b.elementType === b.type ? t : Ci(b.type, t), J);
              x.__reactInternalSnapshotBeforeUpdate = w;
            }
            break;
          case 3:
            var u = b.stateNode.containerInfo;
            1 === u.nodeType ? u.textContent = "" : 9 === u.nodeType && u.documentElement && u.removeChild(u.documentElement);
            break;
          case 5:
          case 6:
          case 4:
          case 17:
            break;
          default:
            throw Error(p(163));
        }
      } catch (F) {
        W2(b, b.return, F);
      }
      a = b.sibling;
      if (null !== a) {
        a.return = b.return;
        V = a;
        break;
      }
      V = b.return;
    }
    n = Nj;
    Nj = false;
    return n;
  }
  function Pj(a, b, c) {
    var d = b.updateQueue;
    d = null !== d ? d.lastEffect : null;
    if (null !== d) {
      var e = d = d.next;
      do {
        if ((e.tag & a) === a) {
          var f = e.destroy;
          e.destroy = void 0;
          void 0 !== f && Mj(b, c, f);
        }
        e = e.next;
      } while (e !== d);
    }
  }
  function Qj(a, b) {
    b = b.updateQueue;
    b = null !== b ? b.lastEffect : null;
    if (null !== b) {
      var c = b = b.next;
      do {
        if ((c.tag & a) === a) {
          var d = c.create;
          c.destroy = d();
        }
        c = c.next;
      } while (c !== b);
    }
  }
  function Rj(a) {
    var b = a.ref;
    if (null !== b) {
      var c = a.stateNode;
      switch (a.tag) {
        case 5:
          a = c;
          break;
        default:
          a = c;
      }
      "function" === typeof b ? b(a) : b.current = a;
    }
  }
  function Sj(a) {
    var b = a.alternate;
    null !== b && (a.alternate = null, Sj(b));
    a.child = null;
    a.deletions = null;
    a.sibling = null;
    5 === a.tag && (b = a.stateNode, null !== b && (delete b[Of], delete b[Pf], delete b[of], delete b[Qf], delete b[Rf]));
    a.stateNode = null;
    a.return = null;
    a.dependencies = null;
    a.memoizedProps = null;
    a.memoizedState = null;
    a.pendingProps = null;
    a.stateNode = null;
    a.updateQueue = null;
  }
  function Tj(a) {
    return 5 === a.tag || 3 === a.tag || 4 === a.tag;
  }
  function Uj(a) {
    a: for (; ; ) {
      for (; null === a.sibling; ) {
        if (null === a.return || Tj(a.return)) return null;
        a = a.return;
      }
      a.sibling.return = a.return;
      for (a = a.sibling; 5 !== a.tag && 6 !== a.tag && 18 !== a.tag; ) {
        if (a.flags & 2) continue a;
        if (null === a.child || 4 === a.tag) continue a;
        else a.child.return = a, a = a.child;
      }
      if (!(a.flags & 2)) return a.stateNode;
    }
  }
  function Vj(a, b, c) {
    var d = a.tag;
    if (5 === d || 6 === d) a = a.stateNode, b ? 8 === c.nodeType ? c.parentNode.insertBefore(a, b) : c.insertBefore(a, b) : (8 === c.nodeType ? (b = c.parentNode, b.insertBefore(a, c)) : (b = c, b.appendChild(a)), c = c._reactRootContainer, null !== c && void 0 !== c || null !== b.onclick || (b.onclick = Bf));
    else if (4 !== d && (a = a.child, null !== a)) for (Vj(a, b, c), a = a.sibling; null !== a; ) Vj(a, b, c), a = a.sibling;
  }
  function Wj(a, b, c) {
    var d = a.tag;
    if (5 === d || 6 === d) a = a.stateNode, b ? c.insertBefore(a, b) : c.appendChild(a);
    else if (4 !== d && (a = a.child, null !== a)) for (Wj(a, b, c), a = a.sibling; null !== a; ) Wj(a, b, c), a = a.sibling;
  }
  var X = null, Xj = false;
  function Yj(a, b, c) {
    for (c = c.child; null !== c; ) Zj(a, b, c), c = c.sibling;
  }
  function Zj(a, b, c) {
    if (lc && "function" === typeof lc.onCommitFiberUnmount) try {
      lc.onCommitFiberUnmount(kc, c);
    } catch (h) {
    }
    switch (c.tag) {
      case 5:
        U || Lj(c, b);
      case 6:
        var d = X, e = Xj;
        X = null;
        Yj(a, b, c);
        X = d;
        Xj = e;
        null !== X && (Xj ? (a = X, c = c.stateNode, 8 === a.nodeType ? a.parentNode.removeChild(c) : a.removeChild(c)) : X.removeChild(c.stateNode));
        break;
      case 18:
        null !== X && (Xj ? (a = X, c = c.stateNode, 8 === a.nodeType ? Kf(a.parentNode, c) : 1 === a.nodeType && Kf(a, c), bd(a)) : Kf(X, c.stateNode));
        break;
      case 4:
        d = X;
        e = Xj;
        X = c.stateNode.containerInfo;
        Xj = true;
        Yj(a, b, c);
        X = d;
        Xj = e;
        break;
      case 0:
      case 11:
      case 14:
      case 15:
        if (!U && (d = c.updateQueue, null !== d && (d = d.lastEffect, null !== d))) {
          e = d = d.next;
          do {
            var f = e, g = f.destroy;
            f = f.tag;
            void 0 !== g && (0 !== (f & 2) ? Mj(c, b, g) : 0 !== (f & 4) && Mj(c, b, g));
            e = e.next;
          } while (e !== d);
        }
        Yj(a, b, c);
        break;
      case 1:
        if (!U && (Lj(c, b), d = c.stateNode, "function" === typeof d.componentWillUnmount)) try {
          d.props = c.memoizedProps, d.state = c.memoizedState, d.componentWillUnmount();
        } catch (h) {
          W2(c, b, h);
        }
        Yj(a, b, c);
        break;
      case 21:
        Yj(a, b, c);
        break;
      case 22:
        c.mode & 1 ? (U = (d = U) || null !== c.memoizedState, Yj(a, b, c), U = d) : Yj(a, b, c);
        break;
      default:
        Yj(a, b, c);
    }
  }
  function ak(a) {
    var b = a.updateQueue;
    if (null !== b) {
      a.updateQueue = null;
      var c = a.stateNode;
      null === c && (c = a.stateNode = new Kj());
      b.forEach(function(b2) {
        var d = bk.bind(null, a, b2);
        c.has(b2) || (c.add(b2), b2.then(d, d));
      });
    }
  }
  function ck(a, b) {
    var c = b.deletions;
    if (null !== c) for (var d = 0; d < c.length; d++) {
      var e = c[d];
      try {
        var f = a, g = b, h = g;
        a: for (; null !== h; ) {
          switch (h.tag) {
            case 5:
              X = h.stateNode;
              Xj = false;
              break a;
            case 3:
              X = h.stateNode.containerInfo;
              Xj = true;
              break a;
            case 4:
              X = h.stateNode.containerInfo;
              Xj = true;
              break a;
          }
          h = h.return;
        }
        if (null === X) throw Error(p(160));
        Zj(f, g, e);
        X = null;
        Xj = false;
        var k = e.alternate;
        null !== k && (k.return = null);
        e.return = null;
      } catch (l) {
        W2(e, b, l);
      }
    }
    if (b.subtreeFlags & 12854) for (b = b.child; null !== b; ) dk(b, a), b = b.sibling;
  }
  function dk(a, b) {
    var c = a.alternate, d = a.flags;
    switch (a.tag) {
      case 0:
      case 11:
      case 14:
      case 15:
        ck(b, a);
        ek(a);
        if (d & 4) {
          try {
            Pj(3, a, a.return), Qj(3, a);
          } catch (t) {
            W2(a, a.return, t);
          }
          try {
            Pj(5, a, a.return);
          } catch (t) {
            W2(a, a.return, t);
          }
        }
        break;
      case 1:
        ck(b, a);
        ek(a);
        d & 512 && null !== c && Lj(c, c.return);
        break;
      case 5:
        ck(b, a);
        ek(a);
        d & 512 && null !== c && Lj(c, c.return);
        if (a.flags & 32) {
          var e = a.stateNode;
          try {
            ob(e, "");
          } catch (t) {
            W2(a, a.return, t);
          }
        }
        if (d & 4 && (e = a.stateNode, null != e)) {
          var f = a.memoizedProps, g = null !== c ? c.memoizedProps : f, h = a.type, k = a.updateQueue;
          a.updateQueue = null;
          if (null !== k) try {
            "input" === h && "radio" === f.type && null != f.name && ab(e, f);
            vb(h, g);
            var l = vb(h, f);
            for (g = 0; g < k.length; g += 2) {
              var m = k[g], q = k[g + 1];
              "style" === m ? sb(e, q) : "dangerouslySetInnerHTML" === m ? nb(e, q) : "children" === m ? ob(e, q) : ta(e, m, q, l);
            }
            switch (h) {
              case "input":
                bb(e, f);
                break;
              case "textarea":
                ib(e, f);
                break;
              case "select":
                var r = e._wrapperState.wasMultiple;
                e._wrapperState.wasMultiple = !!f.multiple;
                var y = f.value;
                null != y ? fb(e, !!f.multiple, y, false) : r !== !!f.multiple && (null != f.defaultValue ? fb(
                  e,
                  !!f.multiple,
                  f.defaultValue,
                  true
                ) : fb(e, !!f.multiple, f.multiple ? [] : "", false));
            }
            e[Pf] = f;
          } catch (t) {
            W2(a, a.return, t);
          }
        }
        break;
      case 6:
        ck(b, a);
        ek(a);
        if (d & 4) {
          if (null === a.stateNode) throw Error(p(162));
          e = a.stateNode;
          f = a.memoizedProps;
          try {
            e.nodeValue = f;
          } catch (t) {
            W2(a, a.return, t);
          }
        }
        break;
      case 3:
        ck(b, a);
        ek(a);
        if (d & 4 && null !== c && c.memoizedState.isDehydrated) try {
          bd(b.containerInfo);
        } catch (t) {
          W2(a, a.return, t);
        }
        break;
      case 4:
        ck(b, a);
        ek(a);
        break;
      case 13:
        ck(b, a);
        ek(a);
        e = a.child;
        e.flags & 8192 && (f = null !== e.memoizedState, e.stateNode.isHidden = f, !f || null !== e.alternate && null !== e.alternate.memoizedState || (fk = B()));
        d & 4 && ak(a);
        break;
      case 22:
        m = null !== c && null !== c.memoizedState;
        a.mode & 1 ? (U = (l = U) || m, ck(b, a), U = l) : ck(b, a);
        ek(a);
        if (d & 8192) {
          l = null !== a.memoizedState;
          if ((a.stateNode.isHidden = l) && !m && 0 !== (a.mode & 1)) for (V = a, m = a.child; null !== m; ) {
            for (q = V = m; null !== V; ) {
              r = V;
              y = r.child;
              switch (r.tag) {
                case 0:
                case 11:
                case 14:
                case 15:
                  Pj(4, r, r.return);
                  break;
                case 1:
                  Lj(r, r.return);
                  var n = r.stateNode;
                  if ("function" === typeof n.componentWillUnmount) {
                    d = r;
                    c = r.return;
                    try {
                      b = d, n.props = b.memoizedProps, n.state = b.memoizedState, n.componentWillUnmount();
                    } catch (t) {
                      W2(d, c, t);
                    }
                  }
                  break;
                case 5:
                  Lj(r, r.return);
                  break;
                case 22:
                  if (null !== r.memoizedState) {
                    gk(q);
                    continue;
                  }
              }
              null !== y ? (y.return = r, V = y) : gk(q);
            }
            m = m.sibling;
          }
          a: for (m = null, q = a; ; ) {
            if (5 === q.tag) {
              if (null === m) {
                m = q;
                try {
                  e = q.stateNode, l ? (f = e.style, "function" === typeof f.setProperty ? f.setProperty("display", "none", "important") : f.display = "none") : (h = q.stateNode, k = q.memoizedProps.style, g = void 0 !== k && null !== k && k.hasOwnProperty("display") ? k.display : null, h.style.display = rb("display", g));
                } catch (t) {
                  W2(a, a.return, t);
                }
              }
            } else if (6 === q.tag) {
              if (null === m) try {
                q.stateNode.nodeValue = l ? "" : q.memoizedProps;
              } catch (t) {
                W2(a, a.return, t);
              }
            } else if ((22 !== q.tag && 23 !== q.tag || null === q.memoizedState || q === a) && null !== q.child) {
              q.child.return = q;
              q = q.child;
              continue;
            }
            if (q === a) break a;
            for (; null === q.sibling; ) {
              if (null === q.return || q.return === a) break a;
              m === q && (m = null);
              q = q.return;
            }
            m === q && (m = null);
            q.sibling.return = q.return;
            q = q.sibling;
          }
        }
        break;
      case 19:
        ck(b, a);
        ek(a);
        d & 4 && ak(a);
        break;
      case 21:
        break;
      default:
        ck(
          b,
          a
        ), ek(a);
    }
  }
  function ek(a) {
    var b = a.flags;
    if (b & 2) {
      try {
        a: {
          for (var c = a.return; null !== c; ) {
            if (Tj(c)) {
              var d = c;
              break a;
            }
            c = c.return;
          }
          throw Error(p(160));
        }
        switch (d.tag) {
          case 5:
            var e = d.stateNode;
            d.flags & 32 && (ob(e, ""), d.flags &= -33);
            var f = Uj(a);
            Wj(a, f, e);
            break;
          case 3:
          case 4:
            var g = d.stateNode.containerInfo, h = Uj(a);
            Vj(a, h, g);
            break;
          default:
            throw Error(p(161));
        }
      } catch (k) {
        W2(a, a.return, k);
      }
      a.flags &= -3;
    }
    b & 4096 && (a.flags &= -4097);
  }
  function hk(a, b, c) {
    V = a;
    ik(a);
  }
  function ik(a, b, c) {
    for (var d = 0 !== (a.mode & 1); null !== V; ) {
      var e = V, f = e.child;
      if (22 === e.tag && d) {
        var g = null !== e.memoizedState || Jj;
        if (!g) {
          var h = e.alternate, k = null !== h && null !== h.memoizedState || U;
          h = Jj;
          var l = U;
          Jj = g;
          if ((U = k) && !l) for (V = e; null !== V; ) g = V, k = g.child, 22 === g.tag && null !== g.memoizedState ? jk(e) : null !== k ? (k.return = g, V = k) : jk(e);
          for (; null !== f; ) V = f, ik(f), f = f.sibling;
          V = e;
          Jj = h;
          U = l;
        }
        kk(a);
      } else 0 !== (e.subtreeFlags & 8772) && null !== f ? (f.return = e, V = f) : kk(a);
    }
  }
  function kk(a) {
    for (; null !== V; ) {
      var b = V;
      if (0 !== (b.flags & 8772)) {
        var c = b.alternate;
        try {
          if (0 !== (b.flags & 8772)) switch (b.tag) {
            case 0:
            case 11:
            case 15:
              U || Qj(5, b);
              break;
            case 1:
              var d = b.stateNode;
              if (b.flags & 4 && !U) if (null === c) d.componentDidMount();
              else {
                var e = b.elementType === b.type ? c.memoizedProps : Ci(b.type, c.memoizedProps);
                d.componentDidUpdate(e, c.memoizedState, d.__reactInternalSnapshotBeforeUpdate);
              }
              var f = b.updateQueue;
              null !== f && sh(b, f, d);
              break;
            case 3:
              var g = b.updateQueue;
              if (null !== g) {
                c = null;
                if (null !== b.child) switch (b.child.tag) {
                  case 5:
                    c = b.child.stateNode;
                    break;
                  case 1:
                    c = b.child.stateNode;
                }
                sh(b, g, c);
              }
              break;
            case 5:
              var h = b.stateNode;
              if (null === c && b.flags & 4) {
                c = h;
                var k = b.memoizedProps;
                switch (b.type) {
                  case "button":
                  case "input":
                  case "select":
                  case "textarea":
                    k.autoFocus && c.focus();
                    break;
                  case "img":
                    k.src && (c.src = k.src);
                }
              }
              break;
            case 6:
              break;
            case 4:
              break;
            case 12:
              break;
            case 13:
              if (null === b.memoizedState) {
                var l = b.alternate;
                if (null !== l) {
                  var m = l.memoizedState;
                  if (null !== m) {
                    var q = m.dehydrated;
                    null !== q && bd(q);
                  }
                }
              }
              break;
            case 19:
            case 17:
            case 21:
            case 22:
            case 23:
            case 25:
              break;
            default:
              throw Error(p(163));
          }
          U || b.flags & 512 && Rj(b);
        } catch (r) {
          W2(b, b.return, r);
        }
      }
      if (b === a) {
        V = null;
        break;
      }
      c = b.sibling;
      if (null !== c) {
        c.return = b.return;
        V = c;
        break;
      }
      V = b.return;
    }
  }
  function gk(a) {
    for (; null !== V; ) {
      var b = V;
      if (b === a) {
        V = null;
        break;
      }
      var c = b.sibling;
      if (null !== c) {
        c.return = b.return;
        V = c;
        break;
      }
      V = b.return;
    }
  }
  function jk(a) {
    for (; null !== V; ) {
      var b = V;
      try {
        switch (b.tag) {
          case 0:
          case 11:
          case 15:
            var c = b.return;
            try {
              Qj(4, b);
            } catch (k) {
              W2(b, c, k);
            }
            break;
          case 1:
            var d = b.stateNode;
            if ("function" === typeof d.componentDidMount) {
              var e = b.return;
              try {
                d.componentDidMount();
              } catch (k) {
                W2(b, e, k);
              }
            }
            var f = b.return;
            try {
              Rj(b);
            } catch (k) {
              W2(b, f, k);
            }
            break;
          case 5:
            var g = b.return;
            try {
              Rj(b);
            } catch (k) {
              W2(b, g, k);
            }
        }
      } catch (k) {
        W2(b, b.return, k);
      }
      if (b === a) {
        V = null;
        break;
      }
      var h = b.sibling;
      if (null !== h) {
        h.return = b.return;
        V = h;
        break;
      }
      V = b.return;
    }
  }
  var lk = Math.ceil, mk = ua.ReactCurrentDispatcher, nk = ua.ReactCurrentOwner, ok = ua.ReactCurrentBatchConfig, K = 0, Q = null, Y = null, Z = 0, fj = 0, ej = Uf(0), T = 0, pk = null, rh = 0, qk = 0, rk = 0, sk = null, tk = null, fk = 0, Gj = Infinity, uk = null, Oi = false, Pi = null, Ri = null, vk = false, wk = null, xk = 0, yk = 0, zk = null, Ak = -1, Bk = 0;
  function R() {
    return 0 !== (K & 6) ? B() : -1 !== Ak ? Ak : Ak = B();
  }
  function yi(a) {
    if (0 === (a.mode & 1)) return 1;
    if (0 !== (K & 2) && 0 !== Z) return Z & -Z;
    if (null !== Kg.transition) return 0 === Bk && (Bk = yc()), Bk;
    a = C;
    if (0 !== a) return a;
    a = window.event;
    a = void 0 === a ? 16 : jd(a.type);
    return a;
  }
  function gi(a, b, c, d) {
    if (50 < yk) throw yk = 0, zk = null, Error(p(185));
    Ac(a, c, d);
    if (0 === (K & 2) || a !== Q) a === Q && (0 === (K & 2) && (qk |= c), 4 === T && Ck(a, Z)), Dk(a, d), 1 === c && 0 === K && 0 === (b.mode & 1) && (Gj = B() + 500, fg && jg());
  }
  function Dk(a, b) {
    var c = a.callbackNode;
    wc(a, b);
    var d = uc(a, a === Q ? Z : 0);
    if (0 === d) null !== c && bc(c), a.callbackNode = null, a.callbackPriority = 0;
    else if (b = d & -d, a.callbackPriority !== b) {
      null != c && bc(c);
      if (1 === b) 0 === a.tag ? ig(Ek.bind(null, a)) : hg(Ek.bind(null, a)), Jf(function() {
        0 === (K & 6) && jg();
      }), c = null;
      else {
        switch (Dc(d)) {
          case 1:
            c = fc;
            break;
          case 4:
            c = gc;
            break;
          case 16:
            c = hc;
            break;
          case 536870912:
            c = jc;
            break;
          default:
            c = hc;
        }
        c = Fk(c, Gk.bind(null, a));
      }
      a.callbackPriority = b;
      a.callbackNode = c;
    }
  }
  function Gk(a, b) {
    Ak = -1;
    Bk = 0;
    if (0 !== (K & 6)) throw Error(p(327));
    var c = a.callbackNode;
    if (Hk() && a.callbackNode !== c) return null;
    var d = uc(a, a === Q ? Z : 0);
    if (0 === d) return null;
    if (0 !== (d & 30) || 0 !== (d & a.expiredLanes) || b) b = Ik(a, d);
    else {
      b = d;
      var e = K;
      K |= 2;
      var f = Jk();
      if (Q !== a || Z !== b) uk = null, Gj = B() + 500, Kk(a, b);
      do
        try {
          Lk();
          break;
        } catch (h) {
          Mk(a, h);
        }
      while (1);
      $g();
      mk.current = f;
      K = e;
      null !== Y ? b = 0 : (Q = null, Z = 0, b = T);
    }
    if (0 !== b) {
      2 === b && (e = xc(a), 0 !== e && (d = e, b = Nk(a, e)));
      if (1 === b) throw c = pk, Kk(a, 0), Ck(a, d), Dk(a, B()), c;
      if (6 === b) Ck(a, d);
      else {
        e = a.current.alternate;
        if (0 === (d & 30) && !Ok(e) && (b = Ik(a, d), 2 === b && (f = xc(a), 0 !== f && (d = f, b = Nk(a, f))), 1 === b)) throw c = pk, Kk(a, 0), Ck(a, d), Dk(a, B()), c;
        a.finishedWork = e;
        a.finishedLanes = d;
        switch (b) {
          case 0:
          case 1:
            throw Error(p(345));
          case 2:
            Pk(a, tk, uk);
            break;
          case 3:
            Ck(a, d);
            if ((d & 130023424) === d && (b = fk + 500 - B(), 10 < b)) {
              if (0 !== uc(a, 0)) break;
              e = a.suspendedLanes;
              if ((e & d) !== d) {
                R();
                a.pingedLanes |= a.suspendedLanes & e;
                break;
              }
              a.timeoutHandle = Ff(Pk.bind(null, a, tk, uk), b);
              break;
            }
            Pk(a, tk, uk);
            break;
          case 4:
            Ck(a, d);
            if ((d & 4194240) === d) break;
            b = a.eventTimes;
            for (e = -1; 0 < d; ) {
              var g = 31 - oc(d);
              f = 1 << g;
              g = b[g];
              g > e && (e = g);
              d &= ~f;
            }
            d = e;
            d = B() - d;
            d = (120 > d ? 120 : 480 > d ? 480 : 1080 > d ? 1080 : 1920 > d ? 1920 : 3e3 > d ? 3e3 : 4320 > d ? 4320 : 1960 * lk(d / 1960)) - d;
            if (10 < d) {
              a.timeoutHandle = Ff(Pk.bind(null, a, tk, uk), d);
              break;
            }
            Pk(a, tk, uk);
            break;
          case 5:
            Pk(a, tk, uk);
            break;
          default:
            throw Error(p(329));
        }
      }
    }
    Dk(a, B());
    return a.callbackNode === c ? Gk.bind(null, a) : null;
  }
  function Nk(a, b) {
    var c = sk;
    a.current.memoizedState.isDehydrated && (Kk(a, b).flags |= 256);
    a = Ik(a, b);
    2 !== a && (b = tk, tk = c, null !== b && Fj(b));
    return a;
  }
  function Fj(a) {
    null === tk ? tk = a : tk.push.apply(tk, a);
  }
  function Ok(a) {
    for (var b = a; ; ) {
      if (b.flags & 16384) {
        var c = b.updateQueue;
        if (null !== c && (c = c.stores, null !== c)) for (var d = 0; d < c.length; d++) {
          var e = c[d], f = e.getSnapshot;
          e = e.value;
          try {
            if (!He(f(), e)) return false;
          } catch (g) {
            return false;
          }
        }
      }
      c = b.child;
      if (b.subtreeFlags & 16384 && null !== c) c.return = b, b = c;
      else {
        if (b === a) break;
        for (; null === b.sibling; ) {
          if (null === b.return || b.return === a) return true;
          b = b.return;
        }
        b.sibling.return = b.return;
        b = b.sibling;
      }
    }
    return true;
  }
  function Ck(a, b) {
    b &= ~rk;
    b &= ~qk;
    a.suspendedLanes |= b;
    a.pingedLanes &= ~b;
    for (a = a.expirationTimes; 0 < b; ) {
      var c = 31 - oc(b), d = 1 << c;
      a[c] = -1;
      b &= ~d;
    }
  }
  function Ek(a) {
    if (0 !== (K & 6)) throw Error(p(327));
    Hk();
    var b = uc(a, 0);
    if (0 === (b & 1)) return Dk(a, B()), null;
    var c = Ik(a, b);
    if (0 !== a.tag && 2 === c) {
      var d = xc(a);
      0 !== d && (b = d, c = Nk(a, d));
    }
    if (1 === c) throw c = pk, Kk(a, 0), Ck(a, b), Dk(a, B()), c;
    if (6 === c) throw Error(p(345));
    a.finishedWork = a.current.alternate;
    a.finishedLanes = b;
    Pk(a, tk, uk);
    Dk(a, B());
    return null;
  }
  function Qk(a, b) {
    var c = K;
    K |= 1;
    try {
      return a(b);
    } finally {
      K = c, 0 === K && (Gj = B() + 500, fg && jg());
    }
  }
  function Rk(a) {
    null !== wk && 0 === wk.tag && 0 === (K & 6) && Hk();
    var b = K;
    K |= 1;
    var c = ok.transition, d = C;
    try {
      if (ok.transition = null, C = 1, a) return a();
    } finally {
      C = d, ok.transition = c, K = b, 0 === (K & 6) && jg();
    }
  }
  function Hj() {
    fj = ej.current;
    E(ej);
  }
  function Kk(a, b) {
    a.finishedWork = null;
    a.finishedLanes = 0;
    var c = a.timeoutHandle;
    -1 !== c && (a.timeoutHandle = -1, Gf(c));
    if (null !== Y) for (c = Y.return; null !== c; ) {
      var d = c;
      wg(d);
      switch (d.tag) {
        case 1:
          d = d.type.childContextTypes;
          null !== d && void 0 !== d && $f();
          break;
        case 3:
          zh();
          E(Wf);
          E(H);
          Eh();
          break;
        case 5:
          Bh(d);
          break;
        case 4:
          zh();
          break;
        case 13:
          E(L);
          break;
        case 19:
          E(L);
          break;
        case 10:
          ah(d.type._context);
          break;
        case 22:
        case 23:
          Hj();
      }
      c = c.return;
    }
    Q = a;
    Y = a = Pg(a.current, null);
    Z = fj = b;
    T = 0;
    pk = null;
    rk = qk = rh = 0;
    tk = sk = null;
    if (null !== fh) {
      for (b = 0; b < fh.length; b++) if (c = fh[b], d = c.interleaved, null !== d) {
        c.interleaved = null;
        var e = d.next, f = c.pending;
        if (null !== f) {
          var g = f.next;
          f.next = e;
          d.next = g;
        }
        c.pending = d;
      }
      fh = null;
    }
    return a;
  }
  function Mk(a, b) {
    do {
      var c = Y;
      try {
        $g();
        Fh.current = Rh;
        if (Ih) {
          for (var d = M.memoizedState; null !== d; ) {
            var e = d.queue;
            null !== e && (e.pending = null);
            d = d.next;
          }
          Ih = false;
        }
        Hh = 0;
        O = N = M = null;
        Jh = false;
        Kh = 0;
        nk.current = null;
        if (null === c || null === c.return) {
          T = 1;
          pk = b;
          Y = null;
          break;
        }
        a: {
          var f = a, g = c.return, h = c, k = b;
          b = Z;
          h.flags |= 32768;
          if (null !== k && "object" === typeof k && "function" === typeof k.then) {
            var l = k, m = h, q = m.tag;
            if (0 === (m.mode & 1) && (0 === q || 11 === q || 15 === q)) {
              var r = m.alternate;
              r ? (m.updateQueue = r.updateQueue, m.memoizedState = r.memoizedState, m.lanes = r.lanes) : (m.updateQueue = null, m.memoizedState = null);
            }
            var y = Ui(g);
            if (null !== y) {
              y.flags &= -257;
              Vi(y, g, h, f, b);
              y.mode & 1 && Si(f, l, b);
              b = y;
              k = l;
              var n = b.updateQueue;
              if (null === n) {
                var t = /* @__PURE__ */ new Set();
                t.add(k);
                b.updateQueue = t;
              } else n.add(k);
              break a;
            } else {
              if (0 === (b & 1)) {
                Si(f, l, b);
                tj();
                break a;
              }
              k = Error(p(426));
            }
          } else if (I && h.mode & 1) {
            var J = Ui(g);
            if (null !== J) {
              0 === (J.flags & 65536) && (J.flags |= 256);
              Vi(J, g, h, f, b);
              Jg(Ji(k, h));
              break a;
            }
          }
          f = k = Ji(k, h);
          4 !== T && (T = 2);
          null === sk ? sk = [f] : sk.push(f);
          f = g;
          do {
            switch (f.tag) {
              case 3:
                f.flags |= 65536;
                b &= -b;
                f.lanes |= b;
                var x = Ni(f, k, b);
                ph(f, x);
                break a;
              case 1:
                h = k;
                var w = f.type, u = f.stateNode;
                if (0 === (f.flags & 128) && ("function" === typeof w.getDerivedStateFromError || null !== u && "function" === typeof u.componentDidCatch && (null === Ri || !Ri.has(u)))) {
                  f.flags |= 65536;
                  b &= -b;
                  f.lanes |= b;
                  var F = Qi(f, h, b);
                  ph(f, F);
                  break a;
                }
            }
            f = f.return;
          } while (null !== f);
        }
        Sk(c);
      } catch (na) {
        b = na;
        Y === c && null !== c && (Y = c = c.return);
        continue;
      }
      break;
    } while (1);
  }
  function Jk() {
    var a = mk.current;
    mk.current = Rh;
    return null === a ? Rh : a;
  }
  function tj() {
    if (0 === T || 3 === T || 2 === T) T = 4;
    null === Q || 0 === (rh & 268435455) && 0 === (qk & 268435455) || Ck(Q, Z);
  }
  function Ik(a, b) {
    var c = K;
    K |= 2;
    var d = Jk();
    if (Q !== a || Z !== b) uk = null, Kk(a, b);
    do
      try {
        Tk();
        break;
      } catch (e) {
        Mk(a, e);
      }
    while (1);
    $g();
    K = c;
    mk.current = d;
    if (null !== Y) throw Error(p(261));
    Q = null;
    Z = 0;
    return T;
  }
  function Tk() {
    for (; null !== Y; ) Uk(Y);
  }
  function Lk() {
    for (; null !== Y && !cc(); ) Uk(Y);
  }
  function Uk(a) {
    var b = Vk(a.alternate, a, fj);
    a.memoizedProps = a.pendingProps;
    null === b ? Sk(a) : Y = b;
    nk.current = null;
  }
  function Sk(a) {
    var b = a;
    do {
      var c = b.alternate;
      a = b.return;
      if (0 === (b.flags & 32768)) {
        if (c = Ej(c, b, fj), null !== c) {
          Y = c;
          return;
        }
      } else {
        c = Ij(c, b);
        if (null !== c) {
          c.flags &= 32767;
          Y = c;
          return;
        }
        if (null !== a) a.flags |= 32768, a.subtreeFlags = 0, a.deletions = null;
        else {
          T = 6;
          Y = null;
          return;
        }
      }
      b = b.sibling;
      if (null !== b) {
        Y = b;
        return;
      }
      Y = b = a;
    } while (null !== b);
    0 === T && (T = 5);
  }
  function Pk(a, b, c) {
    var d = C, e = ok.transition;
    try {
      ok.transition = null, C = 1, Wk(a, b, c, d);
    } finally {
      ok.transition = e, C = d;
    }
    return null;
  }
  function Wk(a, b, c, d) {
    do
      Hk();
    while (null !== wk);
    if (0 !== (K & 6)) throw Error(p(327));
    c = a.finishedWork;
    var e = a.finishedLanes;
    if (null === c) return null;
    a.finishedWork = null;
    a.finishedLanes = 0;
    if (c === a.current) throw Error(p(177));
    a.callbackNode = null;
    a.callbackPriority = 0;
    var f = c.lanes | c.childLanes;
    Bc(a, f);
    a === Q && (Y = Q = null, Z = 0);
    0 === (c.subtreeFlags & 2064) && 0 === (c.flags & 2064) || vk || (vk = true, Fk(hc, function() {
      Hk();
      return null;
    }));
    f = 0 !== (c.flags & 15990);
    if (0 !== (c.subtreeFlags & 15990) || f) {
      f = ok.transition;
      ok.transition = null;
      var g = C;
      C = 1;
      var h = K;
      K |= 4;
      nk.current = null;
      Oj(a, c);
      dk(c, a);
      Oe(Df);
      dd = !!Cf;
      Df = Cf = null;
      a.current = c;
      hk(c);
      dc();
      K = h;
      C = g;
      ok.transition = f;
    } else a.current = c;
    vk && (vk = false, wk = a, xk = e);
    f = a.pendingLanes;
    0 === f && (Ri = null);
    mc(c.stateNode);
    Dk(a, B());
    if (null !== b) for (d = a.onRecoverableError, c = 0; c < b.length; c++) e = b[c], d(e.value, { componentStack: e.stack, digest: e.digest });
    if (Oi) throw Oi = false, a = Pi, Pi = null, a;
    0 !== (xk & 1) && 0 !== a.tag && Hk();
    f = a.pendingLanes;
    0 !== (f & 1) ? a === zk ? yk++ : (yk = 0, zk = a) : yk = 0;
    jg();
    return null;
  }
  function Hk() {
    if (null !== wk) {
      var a = Dc(xk), b = ok.transition, c = C;
      try {
        ok.transition = null;
        C = 16 > a ? 16 : a;
        if (null === wk) var d = false;
        else {
          a = wk;
          wk = null;
          xk = 0;
          if (0 !== (K & 6)) throw Error(p(331));
          var e = K;
          K |= 4;
          for (V = a.current; null !== V; ) {
            var f = V, g = f.child;
            if (0 !== (V.flags & 16)) {
              var h = f.deletions;
              if (null !== h) {
                for (var k = 0; k < h.length; k++) {
                  var l = h[k];
                  for (V = l; null !== V; ) {
                    var m = V;
                    switch (m.tag) {
                      case 0:
                      case 11:
                      case 15:
                        Pj(8, m, f);
                    }
                    var q = m.child;
                    if (null !== q) q.return = m, V = q;
                    else for (; null !== V; ) {
                      m = V;
                      var r = m.sibling, y = m.return;
                      Sj(m);
                      if (m === l) {
                        V = null;
                        break;
                      }
                      if (null !== r) {
                        r.return = y;
                        V = r;
                        break;
                      }
                      V = y;
                    }
                  }
                }
                var n = f.alternate;
                if (null !== n) {
                  var t = n.child;
                  if (null !== t) {
                    n.child = null;
                    do {
                      var J = t.sibling;
                      t.sibling = null;
                      t = J;
                    } while (null !== t);
                  }
                }
                V = f;
              }
            }
            if (0 !== (f.subtreeFlags & 2064) && null !== g) g.return = f, V = g;
            else b: for (; null !== V; ) {
              f = V;
              if (0 !== (f.flags & 2048)) switch (f.tag) {
                case 0:
                case 11:
                case 15:
                  Pj(9, f, f.return);
              }
              var x = f.sibling;
              if (null !== x) {
                x.return = f.return;
                V = x;
                break b;
              }
              V = f.return;
            }
          }
          var w = a.current;
          for (V = w; null !== V; ) {
            g = V;
            var u = g.child;
            if (0 !== (g.subtreeFlags & 2064) && null !== u) u.return = g, V = u;
            else b: for (g = w; null !== V; ) {
              h = V;
              if (0 !== (h.flags & 2048)) try {
                switch (h.tag) {
                  case 0:
                  case 11:
                  case 15:
                    Qj(9, h);
                }
              } catch (na) {
                W2(h, h.return, na);
              }
              if (h === g) {
                V = null;
                break b;
              }
              var F = h.sibling;
              if (null !== F) {
                F.return = h.return;
                V = F;
                break b;
              }
              V = h.return;
            }
          }
          K = e;
          jg();
          if (lc && "function" === typeof lc.onPostCommitFiberRoot) try {
            lc.onPostCommitFiberRoot(kc, a);
          } catch (na) {
          }
          d = true;
        }
        return d;
      } finally {
        C = c, ok.transition = b;
      }
    }
    return false;
  }
  function Xk(a, b, c) {
    b = Ji(c, b);
    b = Ni(a, b, 1);
    a = nh(a, b, 1);
    b = R();
    null !== a && (Ac(a, 1, b), Dk(a, b));
  }
  function W2(a, b, c) {
    if (3 === a.tag) Xk(a, a, c);
    else for (; null !== b; ) {
      if (3 === b.tag) {
        Xk(b, a, c);
        break;
      } else if (1 === b.tag) {
        var d = b.stateNode;
        if ("function" === typeof b.type.getDerivedStateFromError || "function" === typeof d.componentDidCatch && (null === Ri || !Ri.has(d))) {
          a = Ji(c, a);
          a = Qi(b, a, 1);
          b = nh(b, a, 1);
          a = R();
          null !== b && (Ac(b, 1, a), Dk(b, a));
          break;
        }
      }
      b = b.return;
    }
  }
  function Ti(a, b, c) {
    var d = a.pingCache;
    null !== d && d.delete(b);
    b = R();
    a.pingedLanes |= a.suspendedLanes & c;
    Q === a && (Z & c) === c && (4 === T || 3 === T && (Z & 130023424) === Z && 500 > B() - fk ? Kk(a, 0) : rk |= c);
    Dk(a, b);
  }
  function Yk(a, b) {
    0 === b && (0 === (a.mode & 1) ? b = 1 : (b = sc, sc <<= 1, 0 === (sc & 130023424) && (sc = 4194304)));
    var c = R();
    a = ih(a, b);
    null !== a && (Ac(a, b, c), Dk(a, c));
  }
  function uj(a) {
    var b = a.memoizedState, c = 0;
    null !== b && (c = b.retryLane);
    Yk(a, c);
  }
  function bk(a, b) {
    var c = 0;
    switch (a.tag) {
      case 13:
        var d = a.stateNode;
        var e = a.memoizedState;
        null !== e && (c = e.retryLane);
        break;
      case 19:
        d = a.stateNode;
        break;
      default:
        throw Error(p(314));
    }
    null !== d && d.delete(b);
    Yk(a, c);
  }
  var Vk;
  Vk = function(a, b, c) {
    if (null !== a) if (a.memoizedProps !== b.pendingProps || Wf.current) dh = true;
    else {
      if (0 === (a.lanes & c) && 0 === (b.flags & 128)) return dh = false, yj(a, b, c);
      dh = 0 !== (a.flags & 131072) ? true : false;
    }
    else dh = false, I && 0 !== (b.flags & 1048576) && ug(b, ng, b.index);
    b.lanes = 0;
    switch (b.tag) {
      case 2:
        var d = b.type;
        ij(a, b);
        a = b.pendingProps;
        var e = Yf(b, H.current);
        ch(b, c);
        e = Nh(null, b, d, a, e, c);
        var f = Sh();
        b.flags |= 1;
        "object" === typeof e && null !== e && "function" === typeof e.render && void 0 === e.$$typeof ? (b.tag = 1, b.memoizedState = null, b.updateQueue = null, Zf(d) ? (f = true, cg(b)) : f = false, b.memoizedState = null !== e.state && void 0 !== e.state ? e.state : null, kh(b), e.updater = Ei, b.stateNode = e, e._reactInternals = b, Ii(b, d, a, c), b = jj(null, b, d, true, f, c)) : (b.tag = 0, I && f && vg(b), Xi(null, b, e, c), b = b.child);
        return b;
      case 16:
        d = b.elementType;
        a: {
          ij(a, b);
          a = b.pendingProps;
          e = d._init;
          d = e(d._payload);
          b.type = d;
          e = b.tag = Zk(d);
          a = Ci(d, a);
          switch (e) {
            case 0:
              b = cj(null, b, d, a, c);
              break a;
            case 1:
              b = hj(null, b, d, a, c);
              break a;
            case 11:
              b = Yi(null, b, d, a, c);
              break a;
            case 14:
              b = $i(null, b, d, Ci(d.type, a), c);
              break a;
          }
          throw Error(p(
            306,
            d,
            ""
          ));
        }
        return b;
      case 0:
        return d = b.type, e = b.pendingProps, e = b.elementType === d ? e : Ci(d, e), cj(a, b, d, e, c);
      case 1:
        return d = b.type, e = b.pendingProps, e = b.elementType === d ? e : Ci(d, e), hj(a, b, d, e, c);
      case 3:
        a: {
          kj(b);
          if (null === a) throw Error(p(387));
          d = b.pendingProps;
          f = b.memoizedState;
          e = f.element;
          lh(a, b);
          qh(b, d, null, c);
          var g = b.memoizedState;
          d = g.element;
          if (f.isDehydrated) if (f = { element: d, isDehydrated: false, cache: g.cache, pendingSuspenseBoundaries: g.pendingSuspenseBoundaries, transitions: g.transitions }, b.updateQueue.baseState = f, b.memoizedState = f, b.flags & 256) {
            e = Ji(Error(p(423)), b);
            b = lj(a, b, d, c, e);
            break a;
          } else if (d !== e) {
            e = Ji(Error(p(424)), b);
            b = lj(a, b, d, c, e);
            break a;
          } else for (yg = Lf(b.stateNode.containerInfo.firstChild), xg = b, I = true, zg = null, c = Vg(b, null, d, c), b.child = c; c; ) c.flags = c.flags & -3 | 4096, c = c.sibling;
          else {
            Ig();
            if (d === e) {
              b = Zi(a, b, c);
              break a;
            }
            Xi(a, b, d, c);
          }
          b = b.child;
        }
        return b;
      case 5:
        return Ah(b), null === a && Eg(b), d = b.type, e = b.pendingProps, f = null !== a ? a.memoizedProps : null, g = e.children, Ef(d, e) ? g = null : null !== f && Ef(d, f) && (b.flags |= 32), gj(a, b), Xi(a, b, g, c), b.child;
      case 6:
        return null === a && Eg(b), null;
      case 13:
        return oj(a, b, c);
      case 4:
        return yh(b, b.stateNode.containerInfo), d = b.pendingProps, null === a ? b.child = Ug(b, null, d, c) : Xi(a, b, d, c), b.child;
      case 11:
        return d = b.type, e = b.pendingProps, e = b.elementType === d ? e : Ci(d, e), Yi(a, b, d, e, c);
      case 7:
        return Xi(a, b, b.pendingProps, c), b.child;
      case 8:
        return Xi(a, b, b.pendingProps.children, c), b.child;
      case 12:
        return Xi(a, b, b.pendingProps.children, c), b.child;
      case 10:
        a: {
          d = b.type._context;
          e = b.pendingProps;
          f = b.memoizedProps;
          g = e.value;
          G(Wg, d._currentValue);
          d._currentValue = g;
          if (null !== f) if (He(f.value, g)) {
            if (f.children === e.children && !Wf.current) {
              b = Zi(a, b, c);
              break a;
            }
          } else for (f = b.child, null !== f && (f.return = b); null !== f; ) {
            var h = f.dependencies;
            if (null !== h) {
              g = f.child;
              for (var k = h.firstContext; null !== k; ) {
                if (k.context === d) {
                  if (1 === f.tag) {
                    k = mh(-1, c & -c);
                    k.tag = 2;
                    var l = f.updateQueue;
                    if (null !== l) {
                      l = l.shared;
                      var m = l.pending;
                      null === m ? k.next = k : (k.next = m.next, m.next = k);
                      l.pending = k;
                    }
                  }
                  f.lanes |= c;
                  k = f.alternate;
                  null !== k && (k.lanes |= c);
                  bh(
                    f.return,
                    c,
                    b
                  );
                  h.lanes |= c;
                  break;
                }
                k = k.next;
              }
            } else if (10 === f.tag) g = f.type === b.type ? null : f.child;
            else if (18 === f.tag) {
              g = f.return;
              if (null === g) throw Error(p(341));
              g.lanes |= c;
              h = g.alternate;
              null !== h && (h.lanes |= c);
              bh(g, c, b);
              g = f.sibling;
            } else g = f.child;
            if (null !== g) g.return = f;
            else for (g = f; null !== g; ) {
              if (g === b) {
                g = null;
                break;
              }
              f = g.sibling;
              if (null !== f) {
                f.return = g.return;
                g = f;
                break;
              }
              g = g.return;
            }
            f = g;
          }
          Xi(a, b, e.children, c);
          b = b.child;
        }
        return b;
      case 9:
        return e = b.type, d = b.pendingProps.children, ch(b, c), e = eh(e), d = d(e), b.flags |= 1, Xi(a, b, d, c), b.child;
      case 14:
        return d = b.type, e = Ci(d, b.pendingProps), e = Ci(d.type, e), $i(a, b, d, e, c);
      case 15:
        return bj(a, b, b.type, b.pendingProps, c);
      case 17:
        return d = b.type, e = b.pendingProps, e = b.elementType === d ? e : Ci(d, e), ij(a, b), b.tag = 1, Zf(d) ? (a = true, cg(b)) : a = false, ch(b, c), Gi(b, d, e), Ii(b, d, e, c), jj(null, b, d, true, a, c);
      case 19:
        return xj(a, b, c);
      case 22:
        return dj(a, b, c);
    }
    throw Error(p(156, b.tag));
  };
  function Fk(a, b) {
    return ac(a, b);
  }
  function $k(a, b, c, d) {
    this.tag = a;
    this.key = c;
    this.sibling = this.child = this.return = this.stateNode = this.type = this.elementType = null;
    this.index = 0;
    this.ref = null;
    this.pendingProps = b;
    this.dependencies = this.memoizedState = this.updateQueue = this.memoizedProps = null;
    this.mode = d;
    this.subtreeFlags = this.flags = 0;
    this.deletions = null;
    this.childLanes = this.lanes = 0;
    this.alternate = null;
  }
  function Bg(a, b, c, d) {
    return new $k(a, b, c, d);
  }
  function aj(a) {
    a = a.prototype;
    return !(!a || !a.isReactComponent);
  }
  function Zk(a) {
    if ("function" === typeof a) return aj(a) ? 1 : 0;
    if (void 0 !== a && null !== a) {
      a = a.$$typeof;
      if (a === Da) return 11;
      if (a === Ga) return 14;
    }
    return 2;
  }
  function Pg(a, b) {
    var c = a.alternate;
    null === c ? (c = Bg(a.tag, b, a.key, a.mode), c.elementType = a.elementType, c.type = a.type, c.stateNode = a.stateNode, c.alternate = a, a.alternate = c) : (c.pendingProps = b, c.type = a.type, c.flags = 0, c.subtreeFlags = 0, c.deletions = null);
    c.flags = a.flags & 14680064;
    c.childLanes = a.childLanes;
    c.lanes = a.lanes;
    c.child = a.child;
    c.memoizedProps = a.memoizedProps;
    c.memoizedState = a.memoizedState;
    c.updateQueue = a.updateQueue;
    b = a.dependencies;
    c.dependencies = null === b ? null : { lanes: b.lanes, firstContext: b.firstContext };
    c.sibling = a.sibling;
    c.index = a.index;
    c.ref = a.ref;
    return c;
  }
  function Rg(a, b, c, d, e, f) {
    var g = 2;
    d = a;
    if ("function" === typeof a) aj(a) && (g = 1);
    else if ("string" === typeof a) g = 5;
    else a: switch (a) {
      case ya:
        return Tg(c.children, e, f, b);
      case za:
        g = 8;
        e |= 8;
        break;
      case Aa:
        return a = Bg(12, c, b, e | 2), a.elementType = Aa, a.lanes = f, a;
      case Ea:
        return a = Bg(13, c, b, e), a.elementType = Ea, a.lanes = f, a;
      case Fa:
        return a = Bg(19, c, b, e), a.elementType = Fa, a.lanes = f, a;
      case Ia:
        return pj(c, e, f, b);
      default:
        if ("object" === typeof a && null !== a) switch (a.$$typeof) {
          case Ba:
            g = 10;
            break a;
          case Ca:
            g = 9;
            break a;
          case Da:
            g = 11;
            break a;
          case Ga:
            g = 14;
            break a;
          case Ha:
            g = 16;
            d = null;
            break a;
        }
        throw Error(p(130, null == a ? a : typeof a, ""));
    }
    b = Bg(g, c, b, e);
    b.elementType = a;
    b.type = d;
    b.lanes = f;
    return b;
  }
  function Tg(a, b, c, d) {
    a = Bg(7, a, d, b);
    a.lanes = c;
    return a;
  }
  function pj(a, b, c, d) {
    a = Bg(22, a, d, b);
    a.elementType = Ia;
    a.lanes = c;
    a.stateNode = { isHidden: false };
    return a;
  }
  function Qg(a, b, c) {
    a = Bg(6, a, null, b);
    a.lanes = c;
    return a;
  }
  function Sg(a, b, c) {
    b = Bg(4, null !== a.children ? a.children : [], a.key, b);
    b.lanes = c;
    b.stateNode = { containerInfo: a.containerInfo, pendingChildren: null, implementation: a.implementation };
    return b;
  }
  function al(a, b, c, d, e) {
    this.tag = b;
    this.containerInfo = a;
    this.finishedWork = this.pingCache = this.current = this.pendingChildren = null;
    this.timeoutHandle = -1;
    this.callbackNode = this.pendingContext = this.context = null;
    this.callbackPriority = 0;
    this.eventTimes = zc(0);
    this.expirationTimes = zc(-1);
    this.entangledLanes = this.finishedLanes = this.mutableReadLanes = this.expiredLanes = this.pingedLanes = this.suspendedLanes = this.pendingLanes = 0;
    this.entanglements = zc(0);
    this.identifierPrefix = d;
    this.onRecoverableError = e;
    this.mutableSourceEagerHydrationData = null;
  }
  function bl(a, b, c, d, e, f, g, h, k) {
    a = new al(a, b, c, h, k);
    1 === b ? (b = 1, true === f && (b |= 8)) : b = 0;
    f = Bg(3, null, null, b);
    a.current = f;
    f.stateNode = a;
    f.memoizedState = { element: d, isDehydrated: c, cache: null, transitions: null, pendingSuspenseBoundaries: null };
    kh(f);
    return a;
  }
  function cl(a, b, c) {
    var d = 3 < arguments.length && void 0 !== arguments[3] ? arguments[3] : null;
    return { $$typeof: wa, key: null == d ? null : "" + d, children: a, containerInfo: b, implementation: c };
  }
  function dl(a) {
    if (!a) return Vf;
    a = a._reactInternals;
    a: {
      if (Vb(a) !== a || 1 !== a.tag) throw Error(p(170));
      var b = a;
      do {
        switch (b.tag) {
          case 3:
            b = b.stateNode.context;
            break a;
          case 1:
            if (Zf(b.type)) {
              b = b.stateNode.__reactInternalMemoizedMergedChildContext;
              break a;
            }
        }
        b = b.return;
      } while (null !== b);
      throw Error(p(171));
    }
    if (1 === a.tag) {
      var c = a.type;
      if (Zf(c)) return bg(a, c, b);
    }
    return b;
  }
  function el(a, b, c, d, e, f, g, h, k) {
    a = bl(c, d, true, a, e, f, g, h, k);
    a.context = dl(null);
    c = a.current;
    d = R();
    e = yi(c);
    f = mh(d, e);
    f.callback = void 0 !== b && null !== b ? b : null;
    nh(c, f, e);
    a.current.lanes = e;
    Ac(a, e, d);
    Dk(a, d);
    return a;
  }
  function fl(a, b, c, d) {
    var e = b.current, f = R(), g = yi(e);
    c = dl(c);
    null === b.context ? b.context = c : b.pendingContext = c;
    b = mh(f, g);
    b.payload = { element: a };
    d = void 0 === d ? null : d;
    null !== d && (b.callback = d);
    a = nh(e, b, g);
    null !== a && (gi(a, e, g, f), oh(a, e, g));
    return g;
  }
  function gl(a) {
    a = a.current;
    if (!a.child) return null;
    switch (a.child.tag) {
      case 5:
        return a.child.stateNode;
      default:
        return a.child.stateNode;
    }
  }
  function hl(a, b) {
    a = a.memoizedState;
    if (null !== a && null !== a.dehydrated) {
      var c = a.retryLane;
      a.retryLane = 0 !== c && c < b ? c : b;
    }
  }
  function il(a, b) {
    hl(a, b);
    (a = a.alternate) && hl(a, b);
  }
  function jl() {
    return null;
  }
  var kl = "function" === typeof reportError ? reportError : function(a) {
    console.error(a);
  };
  function ll(a) {
    this._internalRoot = a;
  }
  ml.prototype.render = ll.prototype.render = function(a) {
    var b = this._internalRoot;
    if (null === b) throw Error(p(409));
    fl(a, b, null, null);
  };
  ml.prototype.unmount = ll.prototype.unmount = function() {
    var a = this._internalRoot;
    if (null !== a) {
      this._internalRoot = null;
      var b = a.containerInfo;
      Rk(function() {
        fl(null, a, null, null);
      });
      b[uf] = null;
    }
  };
  function ml(a) {
    this._internalRoot = a;
  }
  ml.prototype.unstable_scheduleHydration = function(a) {
    if (a) {
      var b = Hc();
      a = { blockedOn: null, target: a, priority: b };
      for (var c = 0; c < Qc.length && 0 !== b && b < Qc[c].priority; c++) ;
      Qc.splice(c, 0, a);
      0 === c && Vc(a);
    }
  };
  function nl(a) {
    return !(!a || 1 !== a.nodeType && 9 !== a.nodeType && 11 !== a.nodeType);
  }
  function ol(a) {
    return !(!a || 1 !== a.nodeType && 9 !== a.nodeType && 11 !== a.nodeType && (8 !== a.nodeType || " react-mount-point-unstable " !== a.nodeValue));
  }
  function pl() {
  }
  function ql(a, b, c, d, e) {
    if (e) {
      if ("function" === typeof d) {
        var f = d;
        d = function() {
          var a2 = gl(g);
          f.call(a2);
        };
      }
      var g = el(b, d, a, 0, null, false, false, "", pl);
      a._reactRootContainer = g;
      a[uf] = g.current;
      sf(8 === a.nodeType ? a.parentNode : a);
      Rk();
      return g;
    }
    for (; e = a.lastChild; ) a.removeChild(e);
    if ("function" === typeof d) {
      var h = d;
      d = function() {
        var a2 = gl(k);
        h.call(a2);
      };
    }
    var k = bl(a, 0, false, null, null, false, false, "", pl);
    a._reactRootContainer = k;
    a[uf] = k.current;
    sf(8 === a.nodeType ? a.parentNode : a);
    Rk(function() {
      fl(b, k, c, d);
    });
    return k;
  }
  function rl(a, b, c, d, e) {
    var f = c._reactRootContainer;
    if (f) {
      var g = f;
      if ("function" === typeof e) {
        var h = e;
        e = function() {
          var a2 = gl(g);
          h.call(a2);
        };
      }
      fl(b, g, a, e);
    } else g = ql(c, b, a, e, d);
    return gl(g);
  }
  Ec = function(a) {
    switch (a.tag) {
      case 3:
        var b = a.stateNode;
        if (b.current.memoizedState.isDehydrated) {
          var c = tc(b.pendingLanes);
          0 !== c && (Cc(b, c | 1), Dk(b, B()), 0 === (K & 6) && (Gj = B() + 500, jg()));
        }
        break;
      case 13:
        Rk(function() {
          var b2 = ih(a, 1);
          if (null !== b2) {
            var c2 = R();
            gi(b2, a, 1, c2);
          }
        }), il(a, 1);
    }
  };
  Fc = function(a) {
    if (13 === a.tag) {
      var b = ih(a, 134217728);
      if (null !== b) {
        var c = R();
        gi(b, a, 134217728, c);
      }
      il(a, 134217728);
    }
  };
  Gc = function(a) {
    if (13 === a.tag) {
      var b = yi(a), c = ih(a, b);
      if (null !== c) {
        var d = R();
        gi(c, a, b, d);
      }
      il(a, b);
    }
  };
  Hc = function() {
    return C;
  };
  Ic = function(a, b) {
    var c = C;
    try {
      return C = a, b();
    } finally {
      C = c;
    }
  };
  yb = function(a, b, c) {
    switch (b) {
      case "input":
        bb(a, c);
        b = c.name;
        if ("radio" === c.type && null != b) {
          for (c = a; c.parentNode; ) c = c.parentNode;
          c = c.querySelectorAll("input[name=" + JSON.stringify("" + b) + '][type="radio"]');
          for (b = 0; b < c.length; b++) {
            var d = c[b];
            if (d !== a && d.form === a.form) {
              var e = Db(d);
              if (!e) throw Error(p(90));
              Wa(d);
              bb(d, e);
            }
          }
        }
        break;
      case "textarea":
        ib(a, c);
        break;
      case "select":
        b = c.value, null != b && fb(a, !!c.multiple, b, false);
    }
  };
  Gb = Qk;
  Hb = Rk;
  var sl = { usingClientEntryPoint: false, Events: [Cb, ue, Db, Eb, Fb, Qk] }, tl = { findFiberByHostInstance: Wc, bundleType: 0, version: "18.3.1", rendererPackageName: "react-dom" };
  var ul = { bundleType: tl.bundleType, version: tl.version, rendererPackageName: tl.rendererPackageName, rendererConfig: tl.rendererConfig, overrideHookState: null, overrideHookStateDeletePath: null, overrideHookStateRenamePath: null, overrideProps: null, overridePropsDeletePath: null, overridePropsRenamePath: null, setErrorHandler: null, setSuspenseHandler: null, scheduleUpdate: null, currentDispatcherRef: ua.ReactCurrentDispatcher, findHostInstanceByFiber: function(a) {
    a = Zb(a);
    return null === a ? null : a.stateNode;
  }, findFiberByHostInstance: tl.findFiberByHostInstance || jl, findHostInstancesForRefresh: null, scheduleRefresh: null, scheduleRoot: null, setRefreshHandler: null, getCurrentFiber: null, reconcilerVersion: "18.3.1-next-f1338f8080-20240426" };
  if ("undefined" !== typeof __REACT_DEVTOOLS_GLOBAL_HOOK__) {
    var vl = __REACT_DEVTOOLS_GLOBAL_HOOK__;
    if (!vl.isDisabled && vl.supportsFiber) try {
      kc = vl.inject(ul), lc = vl;
    } catch (a) {
    }
  }
  reactDom_production_min.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED = sl;
  reactDom_production_min.createPortal = function(a, b) {
    var c = 2 < arguments.length && void 0 !== arguments[2] ? arguments[2] : null;
    if (!nl(b)) throw Error(p(200));
    return cl(a, b, null, c);
  };
  reactDom_production_min.createRoot = function(a, b) {
    if (!nl(a)) throw Error(p(299));
    var c = false, d = "", e = kl;
    null !== b && void 0 !== b && (true === b.unstable_strictMode && (c = true), void 0 !== b.identifierPrefix && (d = b.identifierPrefix), void 0 !== b.onRecoverableError && (e = b.onRecoverableError));
    b = bl(a, 1, false, null, null, c, false, d, e);
    a[uf] = b.current;
    sf(8 === a.nodeType ? a.parentNode : a);
    return new ll(b);
  };
  reactDom_production_min.findDOMNode = function(a) {
    if (null == a) return null;
    if (1 === a.nodeType) return a;
    var b = a._reactInternals;
    if (void 0 === b) {
      if ("function" === typeof a.render) throw Error(p(188));
      a = Object.keys(a).join(",");
      throw Error(p(268, a));
    }
    a = Zb(b);
    a = null === a ? null : a.stateNode;
    return a;
  };
  reactDom_production_min.flushSync = function(a) {
    return Rk(a);
  };
  reactDom_production_min.hydrate = function(a, b, c) {
    if (!ol(b)) throw Error(p(200));
    return rl(null, a, b, true, c);
  };
  reactDom_production_min.hydrateRoot = function(a, b, c) {
    if (!nl(a)) throw Error(p(405));
    var d = null != c && c.hydratedSources || null, e = false, f = "", g = kl;
    null !== c && void 0 !== c && (true === c.unstable_strictMode && (e = true), void 0 !== c.identifierPrefix && (f = c.identifierPrefix), void 0 !== c.onRecoverableError && (g = c.onRecoverableError));
    b = el(b, null, a, 1, null != c ? c : null, e, false, f, g);
    a[uf] = b.current;
    sf(a);
    if (d) for (a = 0; a < d.length; a++) c = d[a], e = c._getVersion, e = e(c._source), null == b.mutableSourceEagerHydrationData ? b.mutableSourceEagerHydrationData = [c, e] : b.mutableSourceEagerHydrationData.push(
      c,
      e
    );
    return new ml(b);
  };
  reactDom_production_min.render = function(a, b, c) {
    if (!ol(b)) throw Error(p(200));
    return rl(null, a, b, false, c);
  };
  reactDom_production_min.unmountComponentAtNode = function(a) {
    if (!ol(a)) throw Error(p(40));
    return a._reactRootContainer ? (Rk(function() {
      rl(null, null, a, false, function() {
        a._reactRootContainer = null;
        a[uf] = null;
      });
    }), true) : false;
  };
  reactDom_production_min.unstable_batchedUpdates = Qk;
  reactDom_production_min.unstable_renderSubtreeIntoContainer = function(a, b, c, d) {
    if (!ol(c)) throw Error(p(200));
    if (null == a || void 0 === a._reactInternals) throw Error(p(38));
    return rl(a, b, c, false, d);
  };
  reactDom_production_min.version = "18.3.1-next-f1338f8080-20240426";
  return reactDom_production_min;
}
var hasRequiredReactDom;
function requireReactDom() {
  if (hasRequiredReactDom) return reactDom.exports;
  hasRequiredReactDom = 1;
  function checkDCE() {
    if (typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ === "undefined" || typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE !== "function") {
      return;
    }
    try {
      __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE(checkDCE);
    } catch (err) {
      console.error(err);
    }
  }
  {
    checkDCE();
    reactDom.exports = requireReactDom_production_min();
  }
  return reactDom.exports;
}
var hasRequiredClient;
function requireClient() {
  if (hasRequiredClient) return client;
  hasRequiredClient = 1;
  var m = requireReactDom();
  {
    client.createRoot = m.createRoot;
    client.hydrateRoot = m.hydrateRoot;
  }
  return client;
}
var clientExports = requireClient();
const TONES = ["minimal", "low", "medium", "high", "severe"];
const TONE_SET = new Set(TONES);
function asTone(v) {
  return typeof v === "string" && TONE_SET.has(v) ? v : null;
}
function toneColor(tone) {
  return `var(--tone-${tone})`;
}
function bandRank(bands, label) {
  if (!label) return Number.MAX_SAFE_INTEGER;
  const i = bands.findIndex((b) => b.label === label);
  return i === -1 ? Number.MAX_SAFE_INTEGER : i;
}
function worstBand(bands, labels) {
  let worst = null;
  let worstRank = Number.MAX_SAFE_INTEGER;
  for (const l of labels) {
    const r = bandRank(bands, l);
    if (r < worstRank) {
      worstRank = r;
      worst = l;
    }
  }
  return worst;
}
const isOk = (r) => r.kind === "ok";
function saveFailureText(r, fallback = "That change could not be saved.") {
  switch (r.kind) {
    case "ok":
      return fallback;
    case "reject":
    case "collision":
      return r.errors.join("\n") || fallback;
    case "clarify":
      return r.questions.join("\n") || fallback;
    case "gate":
    case "conflict":
    case "upstream":
      return r.message || fallback;
    // A 404 here covers "does not exist" AND "not yours", deliberately indistinguishable — so the
    // sentence must not claim which, while still telling the reader that reloading is the next move.
    case "notFound":
      return "That run is no longer here — someone may have changed it. Reload the page.";
    case "rateLimited":
      return "Too many requests just now. Wait a moment and try again.";
    case "tooLarge":
      return "That request was too large for the server to accept.";
    case "noAccess":
      return "You are signed in, but this account has not been granted access to that.";
    // Deliberately says the deployment, not the reader. Nothing they can do to their own account fixes it.
    case "surfaceUnavailable":
      return "The settings surface is not configured on this deployment, so nothing could be read or saved. This is a server setting, not your access — an administrator needs to fix it.";
    case "pickAccount":
      return "That identity has more than one account — choose one and try again.";
    //. Says what happened and what fixes it, and does NOT say the change failed:
    // it never reached the server, so nothing was half-done and re-doing it after signing in is safe.
    case "signedOut":
      return "Your session has ended, so nothing was changed. Sign in again and repeat that — it is safe to.";
  }
}
function notCommitted(r) {
  if (!isOk(r)) return null;
  const detail = asString(r.value["commitError"]);
  if (!detail || !detail.trim()) return null;
  return "Saved, and live — but it was not committed to the store, so it can be lost. Tell an administrator before relying on it.";
}
const staffLabel = (brand) => brand ? `${brand} staff` : "Staff";
const operatorName = (brand, opts) => brand || ((opts == null ? void 0 : opts.lead) ? "The operator" : "the operator");
const asString = (v) => typeof v === "string" && v ? v : null;
const asNumber = (v) => typeof v === "number" && Number.isFinite(v) ? v : null;
const asArray = (v) => Array.isArray(v) ? v : [];
const asRecord = (v) => typeof v === "object" && v !== null && !Array.isArray(v) ? v : {};
const asBands = (v) => {
  const out = [];
  for (const raw of asArray(v)) {
    if (typeof raw !== "object" || raw === null) continue;
    const r = raw;
    const label = asString(r["label"]);
    const tone = asTone(r["tone"]);
    if (label && tone) out.push({ label, tone });
  }
  return out;
};
const asRunState = (v) => {
  switch (v) {
    case "queued":
    case "running":
    case "paused":
    case "delivered":
    case "failed":
    // Stopped by someone, on purpose. Terminal and distinct from 'failed': nothing went wrong, and a
    // row that said it did would be telling the person who pressed Stop that their search broke.
    case "cancelled":
      return v;
    // The engine's own park vocabulary. The server maps these to 'paused' before they reach here, so
    // this is the belt: a deployment mid-upgrade, where an older portal-service is still forwarding the
    // raw state, must not render a five-hour pause as "Running".
    case "postponed":
    case "recovering":
    case "parked-for-human":
      return "paused";
    default:
      return "running";
  }
};
const dateFromRunId = (runId) => {
  const m = /(\d{4}-\d{2}-\d{2})/.exec(runId);
  return (m == null ? void 0 : m[1]) ?? null;
};
const usableDate = (metaDate, runId) => {
  if (metaDate && /^\d{4}-\d{2}-\d{2}/.test(metaDate)) return metaDate;
  return dateFromRunId(runId);
};
const decodeRun = (raw) => {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw;
  const runId = asString(r["runId"]);
  if (!runId) return null;
  const bands = asBands(r["bands"]);
  return {
    runId,
    account: asString(r["account"]) ?? "",
    title: asString(r["title"]) ?? runId,
    markName: asString(r["markName"]),
    projectKey: asString(r["projectKey"]),
    projectName: asString(r["projectName"]),
    product: asString(r["product"]),
    stageLabel: asString(r["stageLabel"]),
    productName: asString(r["productName"]),
    kind: r["kind"] === "knockout-batch" ? "knockout-batch" : "clearance",
    state: asRunState(r["state"]),
    pausedKind: r["pausedKind"] === "rate-limit" || r["pausedKind"] === "recovering" || r["pausedKind"] === "operator" ? r["pausedKind"] : null,
    resetsAt: asString(r["resetsAt"]),
    startedAt: asString(r["startedAt"]),
    // A run whose metadata carries no usable date still HAS one: the pool directory is stamped with it
    // at publish. One live run reads literally "undated", and repeating that back is useless to someone
    // scanning a list — while inventing today's date would be worse, so the fallback only ever reads a
    // date that is already part of the run's own identity.
    date: usableDate(asString(r["date"]), runId),
    // No fallback and no repair: a missing ordering key must read as MISSING, so a consumer falls back
    // to `date` deliberately rather than being handed a fabricated instant that sorts wrong.
    issuedAt: asString(r["issuedAt"]),
    band: asString(r["band"]) ?? asString(r["overall"]),
    tone: asTone(r["tone"]),
    bands,
    marks: asArray(r["marks"]).map((m) => {
      if (typeof m !== "object" || m === null) return null;
      const mm = m;
      const name = asString(mm["name"]);
      return name ? { name, band: asString(mm["band"]), tone: asTone(mm["tone"]) } : null;
    }).filter((m) => m !== null),
    reportSchema: asNumber(r["reportSchema"]),
    held: r["held"] === true,
    report: asString(r["report"]),
    reports: Array.isArray(r["reports"]) ? r["reports"].flatMap((x) => {
      const row = x;
      const path = asString(row["path"]);
      return path ? [{ mark: asString(row["mark"]), slug: asString(row["slug"]), path }] : [];
    }) : [],
    step: asString(r["step"]),
    stopRequestedAt: asString(r["stopRequestedAt"]),
    stepN: asNumber(r["stepN"]),
    stepTotal: asNumber(r["stepTotal"]),
    reason: asString(r["reason"]),
    failedStage: asString(r["failedStage"]),
    reasonDetail: asString(r["reasonDetail"]),
    acked: r["acked"] === true,
    // Only a queued row has a place in line. Pinning it to the state here means a stale or
    // mis-stamped position can never survive onto a running card as a phantom ordinal.
    queuePos: asRunState(r["state"]) === "queued" ? asNumber(r["queuePos"]) : null
  };
};
const errorsOf = (body) => {
  const list = asArray(body["errors"]).filter((e) => typeof e === "string");
  if (list.length) return list;
  const one = asString(body["error"]);
  return one ? [one] : ["The request could not be completed."];
};
function decodeStatus(status, body) {
  switch (status) {
    case 400: {
      const msg = asString(body["error"]) ?? "";
      if (/name an account/i.test(msg)) return { kind: "pickAccount" };
      return { kind: "reject", errors: errorsOf(body) };
    }
    case 401:
      return { kind: "signedOut" };
    case 403:
      return { kind: "noAccess" };
    case 404:
      if (asString(body["error"]) === "config_surface_unavailable") return { kind: "surfaceUnavailable" };
      return { kind: "notFound" };
    case 409: {
      const msg = errorsOf(body)[0] ?? "This action could not be completed.";
      return /version|conflict/i.test(msg) && !/confirmation|plan again|re-confirm/i.test(msg) ? { kind: "conflict", message: msg } : { kind: "gate", message: msg };
    }
    case 413:
      return { kind: "tooLarge" };
    case 422: {
      const classify = body["classify"];
      if (classify != null) {
        const questions = asArray(classify["questions"]).filter((q) => typeof q === "string");
        return { kind: "clarify", questions: questions.length ? questions : errorsOf(body) };
      }
      return { kind: "collision", errors: errorsOf(body) };
    }
    case 429:
      return { kind: "rateLimited" };
    default:
      if (status >= 500) return { kind: "upstream", message: asString(body["error"]) ?? `Server error (${status}).` };
      return null;
  }
}
let sessionEndedSubscriber = null;
function onSessionEnded(fn) {
  sessionEndedSubscriber = fn;
  return () => {
    if (sessionEndedSubscriber === fn) sessionEndedSubscriber = null;
  };
}
async function call(path, decode2, init) {
  let res;
  try {
    res = await fetch(path, {
      credentials: "same-origin",
      ...init,
      headers: { accept: "application/json", ...(init == null ? void 0 : init.body) ? { "content-type": "application/json" } : {}, ...init == null ? void 0 : init.headers }
    });
  } catch (e) {
    return { kind: "upstream", message: e instanceof Error ? e.message : "The portal could not be reached." };
  }
  let body = {};
  try {
    const text = await res.text();
    if (text) body = JSON.parse(text);
  } catch {
    if (res.ok) return { kind: "upstream", message: "The server sent a response the portal could not read." };
  }
  const mapped = decodeStatus(res.status, body);
  if ((mapped == null ? void 0 : mapped.kind) === "signedOut") sessionEndedSubscriber == null ? void 0 : sessionEndedSubscriber();
  if (mapped) return mapped;
  if (!res.ok) return { kind: "upstream", message: asString(body["error"]) ?? `Unexpected response (${res.status}).` };
  return { kind: "ok", value: decode2(body) };
}
const accountQuery = (account) => account ? `?account=${encodeURIComponent(account)}` : "";
const decodeReadCapability = (v) => {
  const r = asRecord(v);
  return {
    available: r["available"] === true,
    maxBrief: asNumber(r["maxBrief"]) ?? 12e3,
    note: asString(r["note"])
  };
};
const decodeRead = (v) => {
  const r = asRecord(v);
  return {
    names: asStrings(r["names"]),
    classes: asArray(r["classes"]).filter((c) => typeof c === "number"),
    goods: asString(r["goods"]) ?? "",
    territories: asStrings(r["territories"]),
    // WORLDWIDE AS A STATED FACT, not as an empty list. A brief that says "everywhere" and a brief that
    // says nothing about geography fill the same empty `territories`, and they are different searches.
    worldwide: r["worldwide"] === true,
    // WHICH PRODUCT the brief describes, when it describes one clearly enough to say. Null is the honest
    // answer otherwise, and the composer then asks — it never picks the deepest, or the cheapest.
    product: asString(r["product"]),
    ref: asString(r["ref"]) ?? "",
    deadline: asString(r["deadline"]) ?? "",
    notes: asStrings(r["notes"])
  };
};
const asStrings = (v) => asArray(v).filter((x) => typeof x === "string");
const decodeScope = (v) => {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const r = v;
  return {
    jurisdictions: asStrings(r["jurisdictions"]),
    jurisdictionsFrom: asString(r["jurisdictionsFrom"]) ?? "",
    classes: asArray(r["classes"]).filter((c) => typeof c === "number"),
    classesFrom: asString(r["classesFrom"]) ?? "",
    platforms: asStrings(r["platforms"]),
    platformsAdded: asStrings(r["platformsAdded"]),
    platformsFrom: asString(r["platformsFrom"]) ?? "",
    gridCellsPerVariant: asNumber(r["gridCellsPerVariant"])
  };
};
const decodeEffort = (v) => {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const r = v;
  const units = asNumber(r["units"]);
  const version = asNumber(r["unitsVersion"]);
  if (units == null || version == null) return null;
  return {
    unitsVersion: version,
    units,
    costBand: asNumber(r["costBand"]) ?? 1,
    raw: asNumber(r["raw"]) ?? 0,
    searches: asNumber(r["searches"]) ?? 1,
    turnaround: asString(r["turnaround"]) ?? "",
    turnaroundHours: asNumber(r["turnaroundHours"]) ?? 0
  };
};
const api = {
  me: () => call("/portal/api/me", (b) => ({
    role: b["role"] === "staff" ? "staff" : "client",
    email: asString(b["email"]) ?? "",
    accounts: asArray(b["accounts"]).filter((a) => typeof a === "string"),
    allAccounts: b["accounts"] === "*",
    // Only string→string pairs survive. A malformed entry is dropped rather than rendered, because
    // the fallback (the key) is always correct and "[object Object]" beside a brand owner is not.
    accountNames: Object.fromEntries(
      Object.entries(asRecord(b["accountNames"])).filter(([, v]) => typeof v === "string" && v)
    ),
    concurrentRuns: asNumber(b["concurrentRuns"]),
    // Only the two values a caller may act on survive. Anything else — 'engine-ready' from a future
    // server, a typo, a missing field on an older portal-service — lands as null, which every caller
    // treats as "leave the button alone". Widening this to pass strings through would let an
    // unrecognised value reach a comparison that reads it as demo.
    engineMode: b["engineMode"] === "demo" ? "demo" : b["engineMode"] === "engine-unproven" ? "engine-unproven" : null,
    brand: typeof b["brand"] === "string" ? b["brand"] : "",
    // — a control the deployment cannot serve says so instead of always failing.
    // Absent field (an older portal-service) ⇒ available: the button behaves exactly as before.
    stopControl: (() => {
      const c = asRecord(asRecord(b["controls"])["stop"]);
      return { available: c["available"] !== false, reason: asString(c["reason"]) };
    })()
  })),
  /**
   * Runs for one brand owner, or for ALL of them.
   *
   * `'*'` is the staff "All brand owners" view and is answered in a single pass over the pool. Asking
   * the browser to fan out across the roster instead would spend a roster-sized slice of the 120/min
   * rate limit on every poll. A client who sends `'*'` gets a 404, the same as any account not theirs.
   */
  runs: (account) => call(
    `/portal/api/runs${accountQuery(account)}`,
    (b) => asArray(b["runs"]).map(decodeRun).filter((r) => r !== null)
  ),
  /**
   * Runs across every brand owner this identity holds — one call, whoever is asking.
   *
   * Staff get every account; a client gets exactly its own. The REQUEST IS IDENTICAL either way, which
   * is the point: a screen that is account-scoped rather than owner-scoped never has to ask who is
   * looking, and there is no staff layout to diverge from a client one.
   *
   * Deliberately NOT `runs('*')`. The wildcard means one thing — every account in the deployment,
   * staff only — and overloading it would make `'*'` look like a harmless default worth sending
   * everywhere. Two capabilities, two names.
   */
  runsMine: () => call(
    "/portal/api/runs?scope=mine",
    (b) => asArray(b["runs"]).map(decodeRun).filter((r) => r !== null)
  ),
  /**
   *  — THE CROSS-MARK PARAGRAPH for a run published over several names.
   *
   * A knockout over several names has no combined document, so the one piece of prose that reads the
   * names against each other is written to the run's `report.md` and, until this route existed, reached
   * nobody: the published list names the per-mark documents only. Owner ruling 2026-08-26: the grouped
   * page carries it.
   *
   * ITS OWN CALL RATHER THAN A FIELD ON THE RUN, because the run row is what every screen that lists
   * runs already fetches, and none of them render this. It is asked for once, by the one screen that
   * shows it.
   *
   * `notFound` is the ordinary answer and covers every absence at once — a run with one document (its
   * assessment is inside the document the screen frames), a grouped run whose summary was composed
   * empty, and a run that is not the caller's. The screen renders no panel for any of them, which is
   * the honest rendering of "there is none".
   *
   * The paragraphs carry inline markdown. Read them with `inlineSpans` — never as HTML.
   */
  runSummary: (runId) => call(
    `/portal/api/run/${encodeURIComponent(runId)}/summary`,
    (b) => asArray(b["summary"]).filter((p) => typeof p === "string" && p.trim() !== "")
  ),
  /**
   *  — put a stopped run down, for this reader only.
   *
   * Not a state change, not a delete, and not 's retire: nothing about the run moves and no other
   * reader is affected. `state` is the state you are dismissing it in — the server keys on it, so a run
   * that leaves that state reappears rather than staying hidden.
   */
  acknowledge: (input) => call("/portal/api/ack", (b) => b, {
    method: "POST",
    body: JSON.stringify(input)
  }),
  /**
   * Stop a run that has already started. Terminal and unrecoverable — partial work is not deliverable.
   *
   * NOT INSTANT, and the copy at the call site must not pretend otherwise: the run ends at its next
   * step boundary, a step already under way finishes, and what it has spent is spent.
   */
  /**
   * ──  — TWO STOPS, AND THE ANSWER SAYS WHICH ONE HAPPENED ──────────────────
   *
   * `immediate` is the reader's answer to the question at the press: end the step in flight, or let it
   * finish. It is sent explicitly on both paths rather than omitted for the default, so a reader who
   * chose the safe one is as legible in the audit row as one who chose the other.
   *
   * `stop.mode` is what ACTUALLY happened, and it is not always what was asked: an immediate stop that
   * finds no turn to end becomes a boundary stop, and the driver reports it as one. The screen must
   * read this rather than the press — presenting a fallback as an immediate stop is the same silence
   * this issue was opened about, one layer along.
   */
  stopRun: (runId, account, opts) => call(`/portal/api/run/${encodeURIComponent(runId)}/stop${accountQuery(account)}`, (b) => {
    const st = asRecord(b["stop"]);
    return {
      action: asString(b["action"]),
      // Absent, or anything but the immediate token, is the boundary stop. An older server sends no
      // `stop` block at all and its behaviour WAS the boundary stop, so that is the honest default.
      mode: asString(st["mode"]) === "immediate" ? "immediate" : "boundary",
      note: asString(st["note"])
    };
  }, {
    method: "POST",
    body: JSON.stringify({ immediate: opts.immediate === true })
  }),
  /**
   * Cancel a job that has not started. Nothing ran, so nothing is charged and no row is left behind.
   *
   * Can lose a race with the runner: a 409 with `action: 'already-claimed'` means it started between
   * the click and the request. That is a race, not an error — re-read the list and it is a running run.
   */
  cancelQueued: (id, account) => call(`/portal/api/queue/${encodeURIComponent(id)}/cancel${accountQuery(account)}`, (b) => ({ action: asString(b["action"]) }), {
    method: "POST"
  }),
  /** Set the order queued jobs are admitted in. Only the caller's own jobs move; nobody else's position changes. */
  reorderQueue: (order, account) => call(`/portal/api/queue/order${accountQuery(account)}`, (b) => ({ order: asArray(b["order"]).filter((s) => typeof s === "string") }), {
    method: "POST",
    body: JSON.stringify({ order: [...order] })
  }),
  searches: (account) => call(`/portal/api/searches${accountQuery(account)}`, (b) => ({
    account: asString(b["account"]) ?? "",
    // — null when the server does not send it. See the type's note.
    maxMarkName: asNumber(b["maxMarkName"]),
    products: asArray(b["products"]).map((l) => {
      const r = l;
      return {
        key: asString(r["key"]) ?? "",
        // Empty rather than null, so a call site can write `p.name || p.stageLabel` and get a string
        // from an older server without a null check at every one of them.
        name: asString(r["name"]) ?? "",
        stageLabel: asString(r["stageLabel"]) ?? "",
        pipeline: asString(r["pipeline"]) ?? "",
        components: asArray(r["components"]).filter((c) => typeof c === "string"),
        geography: asString(r["geography"]) ?? "",
        caseLaw: r["caseLaw"] === true,
        nativeLanguage: asString(r["nativeLanguage"]) ?? "absent",
        // The OFFERING'S figure, never a default this file invents. 1 is the safe direction if a server
        // omits it — the screen refuses a batch it could have sent, rather than sending one the wall
        // refuses after the composing is done.
        maxNames: asNumber(r["maxNames"]) ?? 1,
        baseTurnaround: asString(r["baseTurnaround"]),
        baseTurnaroundHours: asNumber(r["baseTurnaroundHours"]),
        orderable: r["orderable"] !== false,
        // Absent ⇒ available. See the field's note: an older server must not grey out the whole menu.
        available: r["available"] !== false,
        unavailableNote: asString(r["unavailableNote"]),
        coverageNote: asString(r["coverageNote"]),
        capabilityNote: asString(r["capabilityNote"])
      };
    }),
    // Tri-state, decoded in the one order that keeps the three apart: absent stays absent (fail open),
    // an explicit null stays null (unrestricted), and anything else must be an array of strings.
    ...!("territories" in b) ? {} : { registerTerritories: b["territories"] === null ? null : asArray(b["territories"]).filter((t) => typeof t === "string") },
    recipes: asArray(b["recipes"]).map((x) => {
      const r = x;
      return {
        slug: asString(r["slug"]) ?? "",
        label: asString(r["label"]) ?? "",
        base: asString(r["base"]) ?? "",
        version: asNumber(r["version"]),
        // Only true means anything, here as at the recipe door: the toggle can add the native-language
        // investigation and can never take one away, so an older server that omits it says "not asked".
        nativeLanguage: r["nativeLanguage"] === true
      };
    }),
    read: decodeReadCapability(b["read"])
  })),
  /**
   * Read a pasted brief into a filled-in composer. Spends nothing on a search.
   *
   * The odd one out among the POSTs here: it mints no token, queues nothing and cannot start a run —
   * it answers with a draft. Everything it fills in is an ordinary editable field afterwards, and the
   * plan gate and review dialog are still ahead of it, unchanged.
   */
  // `feedback` was here and is retired. The endpoint answers 410, so a client method for
  // it would be a method whose only outcome is a refusal.
  composeRead: (brief) => call("/portal/api/compose/read", (b) => decodeRead(b["read"]), {
    method: "POST",
    body: JSON.stringify({ brief })
  }),
  /**
   * Preview what a search WOULD do. Spends nothing.
   *
   * The returned token is one-shot and short-lived, and it is bound to this exact request — changing
   * a class or a word after previewing invalidates it, and `run` will answer 409 rather than quietly
   * running something the user never saw. That is the whole reason this is two calls and not one.
   */
  plan: (account, body) => call(
    "/portal/api/run/plan",
    (b) => ({
      account: asString(b["account"]) ?? "",
      name: asString(b["name"]) ?? "",
      stageLabel: asString(b["stageLabel"]) ?? "",
      marks: asNumber(b["marks"]) ?? 1,
      turnaround: asString(b["turnaround"]),
      warnings: asArray(b["warnings"]).filter((w) => typeof w === "string"),
      caveat: asString(b["caveat"]) ?? "",
      confirmationToken: asString(b["confirmationToken"]) ?? "",
      note: asString(b["note"]) ?? "",
      scope: decodeScope(b["scope"]),
      //. Absent on an older server and on every deployment whose register
      // reaches everything a reader can name — both mean "nothing to disclose", which is why the
      // decode is a plain null rather than the tri-state `registerTerritories` needs.
      coverage: (() => {
        const c = b["coverage"];
        if (!c || typeof c !== "object") return null;
        const r = c;
        const note = asString(r["note"]);
        if (!note) return null;
        return {
          reached: asArray(r["reached"]).filter((x) => typeof x === "string"),
          missing: asArray(r["missing"]).filter((x) => typeof x === "string"),
          note
        };
      })(),
      effort: decodeEffort(b["effort"])
    }),
    { method: "POST", body: JSON.stringify({ ...body, ...account ? { account } : {} }) }
  ),
  /**
   * THE SPEND DOOR. Everything else in this file is free; this one is not — except on a demo, where the
   * server resolves the confirmation to a report that already exists and spends nothing.
   *
   * `landedOn` is how the client learns which happened, and it is the SERVER's answer rather than the
   * client's inference. That matters: a browser that decided for itself that it was in a demo could
   * open a report instead of starting a clearance on a deployment that is not one. Null on every real
   * order, which is every order on every install that is not a demo.
   */
  run: (account, body) => call(
    "/portal/api/run",
    (b) => ({ id: asString(b["id"]) ?? "", landedOn: asString(b["landedOn"]) }),
    { method: "POST", body: JSON.stringify({ ...body, ...account ? { account } : {} }) }
  ),
  /** The brand owner's configuration. The account is resolved server-side from who you signed in as. */
  profile: (account) => call(`/portal/api/config/profile${accountQuery(account)}`, (b) => ({
    account: asString(b["account"]) ?? "",
    profile: asRecord(b["profile"]),
    readOnly: asRecord(b["readOnly"]),
    contextPack: typeof b["contextPack"] === "string" ? b["contextPack"] : "",
    framework: b["framework"] != null ? asRecord(b["framework"]) : null,
    derived: b["derived"] != null ? asRecord(b["derived"]) : null
  })),
  /**
   * Dry-run a profile change, or commit it.
   *
   * `validate` writes nothing and runs the SAME validators the engine runs at load time, so the editor
   * cannot persist a profile the engine would later refuse. Two calls rather than one because a config
   * that fails validation at load time takes the account's searches down with it.
   */
  saveProfile: (account, action, body) => call(`/portal/api/config/profile/${action}`, (b) => b, {
    method: "POST",
    body: JSON.stringify({ ...body, ...account ? { account } : {} })
  }),
  projects: (account) => call(
    `/portal/api/config/projects${accountQuery(account)}`,
    (b) => asArray(b["projects"]).map((p) => {
      const r = p;
      return { key: asString(r["key"]) ?? "", name: asString(r["name"]) ?? "", archived: r["archived"] === true };
    })
  ),
  project: (account, project) => call(`/portal/api/config/projects/${encodeURIComponent(project)}${accountQuery(account)}`, (b) => ({
    customer: asString(b["customer"]) ?? "",
    customerName: asString(b["customerName"]) ?? "",
    project: asString(b["project"]) ?? "",
    overlay: asRecord(b["overlay"]),
    contextPack: typeof b["contextPack"] === "string" ? b["contextPack"] : "",
    inherited: asRecord(b["inherited"]),
    effective: asRecord(b["effective"]),
    origins: asRecord(b["origins"]),
    derived: b["derived"] != null ? asRecord(b["derived"]) : null
  })),
  saveProject: (account, project, action, body) => call(`/portal/api/config/projects/${encodeURIComponent(project)}/${action}`, (b) => b, {
    method: "POST",
    body: JSON.stringify({ ...body, ...account ? { account } : {} })
  }),
  /**
   * The account's saved searches, in full.
   *
   * Distinct from `api.searches`, which is the composer's MENU and returns the offering plus a thin row
   * per saved search. This is the config surface: enough to edit one.
   */
  savedSearches: (account) => call(
    `/portal/api/config/searches${accountQuery(account)}`,
    (b) => asArray(b["recipes"]).map((r) => {
      const o = r;
      return {
        slug: asString(o["slug"]) ?? "",
        label: asString(o["label"]) ?? "",
        base: asString(o["base"]) ?? "",
        archived: o["archived"] === true,
        version: asNumber(o["version"]),
        updatedAt: asString(o["updatedAt"])
      };
    })
  ),
  savedSearch: (account, slug) => call(`/portal/api/config/searches/${encodeURIComponent(slug)}${accountQuery(account)}`, (b) => ({
    slug: asString(b["slug"]) ?? slug,
    recipe: asRecord(b["recipe"]),
    sha: asString(b["sha"]) ?? ""
  })),
  /**
   * Validate or save a saved search.
   *
   * `expectedVersion` is the optimistic-concurrency handle: naming the version an edit was based on
   * turns a silent last-writer-wins clobber into a 409 the editor can act on. Saved searches are the
   * only config surface that has it, so they are also the only one whose editor must render the
   * `conflict` result kind — the projects editor never can, and its error handler shows why that is
   * easy to miss.
   *
   * Archiving is a save carrying `archived: true`. There is deliberately no delete: a saved search that
   * produced a report is part of how that report came to say what it says.
   */
  saveSavedSearch: (account, slug, action, body) => call(`/portal/api/config/searches/${encodeURIComponent(slug)}/${action}`, (b) => b, {
    method: "POST",
    body: JSON.stringify({
      recipe: body.recipe,
      ...body.expectedVersion != null ? { expectedVersion: body.expectedVersion } : {},
      ...account ? { account } : {}
    })
  }),
  /** What this account has used against its allowance. Caps are nullable — null means "unknown". */
  usage: (account) => call(`/portal/api/usage${accountQuery(account)}`, (b) => ({
    account: asString(b["account"]) ?? "",
    today: asNumber(b["today"]) ?? 0,
    thisMonth: asNumber(b["thisMonth"]) ?? 0,
    queued: asNumber(b["queued"]) ?? 0,
    dailyRuns: asNumber(b["dailyRuns"]),
    monthlyRuns: asNumber(b["monthlyRuns"]),
    maxQueued: asNumber(b["maxQueued"]),
    capped: b["capped"] === true
  })),
  /**
   * Connection details for driving the engine from your own assistant.
   * `url` is null when this deployment has no client MCP wired — the screen must render its empty
   * state rather than invent a host (see the note atop UseYourAI.tsx).
   */
  // No account parameter, deliberately: the connector address is one host for the deployment and the
  // sign-in identity is the caller's own. Passing an account made the route resolve one it never used,
  // and staff (whose account resolves to null) were told the connector did not exist.
  /** The source offer. Unauthenticated on the server — a licence notice behind a login is not an offer. */
  about: () => call("/portal/api/about", (b) => ({
    name: asString(b["name"]) ?? "Clearotron",
    version: asString(b["version"]),
    commit: asString(b["commit"]),
    sourceRepo: asString(b["sourceRepo"]) ?? "",
    sourceUrl: asString(b["sourceUrl"]) ?? "",
    license: asString(b["license"]),
    copyright: asString(b["copyright"]) ?? ""
  })),
  mcpAccess: () => call("/portal/api/mcp-access", (b) => ({
    url: asString(b["url"]),
    keyUrl: asString(b["keyUrl"]),
    email: asString(b["email"]),
    enabled: b["enabled"] === true,
    // — VALIDATED, not spread. A wire field is untrusted input like any other,
    // and a half-formed object here would render a Copy button over an undefined command.
    stdio: (() => {
      const r = b["stdio"];
      if (!r || typeof r !== "object") return null;
      const o = r;
      const command = asString(o["command"]);
      const note = asString(o["note"]);
      const verify = asString(o["verify"]);
      return command && note && verify ? { command, note, verify } : null;
    })(),
    // VALIDATED FIELD BY FIELD, never spread — a wire object is untrusted input, and a half-formed row
    // here would render a button over an undefined command. A row missing its identity is dropped
    // rather than rendered nameless.
    offers: asArray(b["offers"]).flatMap((o) => {
      const r = o;
      const id = asString(r["id"]);
      const name = asString(r["name"]);
      if (!id || !name) return [];
      const st = r["stdio"];
      const stdio = st && typeof st === "object" ? (() => {
        const x = st;
        const kind = asString(x["kind"]);
        return kind ? { kind, where: asString(x["where"]), after: asString(x["after"]) } : null;
      })() : null;
      return [{
        id,
        name,
        // Only strings survive, same rule as `accountNames` above: a malformed entry is dropped rather
        // than rendered, because a step that reads "[object Object]" is worse than one fewer step.
        steps: asArray(r["steps"]).filter((x) => typeof x === "string" && x !== ""),
        // Only an https page survives. A wire value of any other shape is dropped rather than opened:
        // this is the one field on this screen that navigates a reader somewhere.
        launch: (() => {
          const u = asString(asRecord(r["launch"])["url"]);
          return u && /^https:\/\//.test(u) ? { url: u } : null;
        })(),
        served: r["served"] === true,
        route: asString(r["route"]),
        command: asString(r["command"]),
        address: asString(r["address"]),
        note: asString(r["note"]),
        reason: asString(r["reason"]),
        fix: asString(r["fix"]),
        stdio,
        // The server sends `enables` — an object naming what would be turned on. Reduced to a BOOLEAN
        // here: the page's business is whether a press changes this install's posture, not which
        // setting carries it. A flag name on a client's screen is the kind of repo-side truth that has
        // no reader on that page.
        opensADoor: r["enables"] != null && r["enables"] !== false
      }];
    })
  })),
  /**
   * Mint THIS caller's own access, for the clipboard (; owner ruling 2026-08-31).
   *
   * The returned key is handed to the clipboard and MUST NOT reach React state, a prop, or the DOM.
   * *"A rendered key outlives the moment. It's in the DOM, in the screenshot someone takes, in the
   * browser cache, on a screen left open."* The one exception is the degraded path where the browser
   * refuses clipboard access entirely, and that is a one-time reveal the reader asked for by pressing.
   *
   * The server mints for the authenticated caller and ignores anything the request says about identity,
   * so this cannot be used to obtain somebody else's credential.
   */
  connectKey: () => call("/portal/api/connect-key", (b) => ({
    address: asString(b["address"]) ?? "",
    key: asString(b["key"]) ?? ""
  }), { method: "POST" }),
  /** Staff-only: what this deployment has switched on. Clients get 404. */
  adminConfig: () => call("/portal/admin/config", (b) => ({
    available: b["available"] === true,
    note: asString(b["note"]),
    capturedAt: asString(b["capturedAt"]),
    stale: b["stale"] === true,
    built: b["built"] != null ? asRecord(b["built"]) : null,
    flags: asArray(b["flags"]).map((f) => {
      const r = f;
      return {
        name: asString(r["name"]) ?? "",
        on: r["on"] === true,
        configured: r["configured"] === true,
        effect: asString(r["effect"]) ?? "unknown",
        killSwitch: r["killSwitch"] === true
      };
    }),
    // NOT `asArray`/`asRecord` here, deliberately: both collapse a missing value to an empty one, and
    // empty is the answer this pair must never give. `providers: []` reads as "no provider is
    // configured" and `engine: {}` as an engine with no name — where the fact is that an older
    // snapshot did not record either. Guarded on the wire type so null survives the hop.
    engine: b["engine"] != null && typeof b["engine"] === "object" && !Array.isArray(b["engine"]) ? (() => {
      const e = asRecord(b["engine"]);
      const bill = asRecord(e["billing"]);
      return {
        id: asString(e["id"]) ?? "unknown",
        vendor: asString(e["vendor"]),
        known: e["known"] === true,
        billing: {
          mode: asString(bill["mode"]) ?? "unknown",
          apiBilled: bill["apiBilled"] === true,
          missing: asStrings(bill["missing"])
        },
        binaryPresent: e["binaryPresent"] === true
      };
    })() : null,
    providers: Array.isArray(b["providers"]) ? asArray(b["providers"]).map((p) => {
      const r = p;
      return {
        key: asString(r["key"]) ?? "",
        label: asString(r["label"]) ?? "",
        provider: asString(r["provider"]),
        providerLabel: asString(r["providerLabel"]),
        known: r["known"] === true,
        configured: r["configured"] === true,
        missing: asStrings(r["missing"]),
        remedy: asString(r["remedy"])
      };
    }) : null,
    // Same wire-type guard as `engine` above, for the same reason: `asRecord` collapses a missing
    // value to `{}`, which would decode as a portal with an empty-string mode and no issuer — a
    // confident description of a door nobody configured. Null must survive the hop so the screen can
    // say "this build did not send it" rather than draw a blank row.
    auth: b["auth"] != null && typeof b["auth"] === "object" && !Array.isArray(b["auth"]) ? (() => {
      const a = asRecord(b["auth"]);
      const shape = asString(a["shape"]);
      return {
        mode: asString(a["mode"]) ?? "unknown",
        declared: asString(a["declared"]),
        shape: shape === "local" || shape === "fronted" ? shape : "unrecognised",
        issuer: asString(a["issuer"]),
        missing: asStrings(a["missing"])
      };
    })() : null
  })),
  /** Staff-only: who is granted what, and where an enrolment is half done. */
  adminAccess: () => call("/portal/admin/access", (b) => ({
    note: asString(b["note"]) ?? "",
    staffDomains: asArray(b["staffDomains"]).filter((s) => typeof s === "string"),
    unknownAccounts: asArray(b["unknownAccounts"]).filter((s) => typeof s === "string"),
    people: asArray(b["people"]).map((p) => {
      const r = p;
      return {
        email: asString(r["email"]) ?? "",
        tenant: asString(r["tenant"]) ?? "",
        accounts: asArray(r["accounts"]).filter((s) => typeof s === "string"),
        dangling: asArray(r["dangling"]).filter((s) => typeof s === "string"),
        wildcard: r["wildcard"] === true
      };
    }),
    grantsFile: (() => {
      const g = b["grantsFile"];
      const name = asString(g == null ? void 0 : g["name"]);
      const modifiedAt = asString(g == null ? void 0 : g["modifiedAt"]);
      return name && modifiedAt ? { name, modifiedAt } : null;
    })()
  })),
  /**
   * Staff-only, best-effort. ALWAYS 200 — `available:false` is the shape for "the log could not be
   * read", so this can never blank the access page it sits on.
   */
  adminObserved: () => call("/portal/admin/observed", (b) => ({
    available: b["available"] === true,
    truncated: b["truncated"] === true,
    note: asString(b["note"]) ?? null,
    people: asArray(b["people"]).map((p) => {
      const r = p;
      const events = r["events"];
      return {
        email: asString(r["email"]) ?? "",
        events: events && typeof events === "object" && !Array.isArray(events) ? Object.fromEntries(Object.entries(events).filter(([, n]) => typeof n === "number")) : {},
        accounts: asArray(r["accounts"]).filter((s) => typeof s === "string"),
        firstSeen: asString(r["firstSeen"]) ?? null,
        lastSeen: asString(r["lastSeen"]) ?? null,
        count: typeof r["count"] === "number" ? r["count"] : 0
      };
    })
  })),
  /** Staff-only. Clients get 404, which decodes to `notFound` and is simply not rendered. */
  /**
   * The mark families staff have asserted.
   *
   * Staff-only upstream, and the caller is expected to treat any non-ok answer as "no families" rather
   * than as an error: for a client this route legitimately 404s, and a Clearances page that reported a
   * fault because grouping was unavailable would be broken for every client on every load.
   */
  families: (account) => call(`/portal/admin/families${accountQuery(account)}`, (b) => ({
    of: b["of"] ?? {},
    names: b["names"] ?? {}
  })),
  /** Assert (or dissolve) a family over a set of runs. The server resolves the owner from the runs. */
  setFamily: (input) => call("/portal/admin/families", (b) => b, {
    method: "POST",
    body: JSON.stringify(input)
  }),
  /**
   * The runs staff have RETIRED — the fold, and only the fold.
   *
   * Retired runs are gone from every other listing by design, so this is the only way to find one
   * again. Staff-only upstream: like `families`, a client's 404 decodes to `notFound` and the caller
   * treats it as "no retired view", never as a fault.
   */
  retiredRuns: (account) => call(
    `/portal/admin/retired${accountQuery(account)}`,
    (b) => asArray(b["runs"]).map(decodeRun).filter((r) => r !== null)
  ),
  /**
   * Retire runs, or bring them back. RETIRE, NOT DELETE — this writes one visibility tag and nothing
   * else; the run, its artifacts and its report link are untouched, and `restore` is the exact inverse.
   */
  setRetired: (input) => call("/portal/admin/retired", (b) => b, {
    method: "POST",
    body: JSON.stringify(input)
  }),
  roster: () => call(
    "/portal/admin/roster",
    (b) => asArray(b["customers"]).map((c) => {
      const r = c;
      return { key: asString(r["key"]) ?? "", name: asString(r["name"]) ?? "" };
    })
  )
};
const NAV = [
  // Home leads: it is where the portal opens and it answers "what is happening with my work" before
  // anything is clicked. Clearances stays, as the archive it always was.
  { id: "home", label: "Home", path: "/portal/home", icon: "panel-left", scope: "account" },
  { id: "clearances", label: "Clearances", path: "/portal/clearances", icon: "layers", scope: "account" },
  // The engine being model-agnostic and reachable over MCP is a selling point, not a settings detail —
  // and the connector is issued per identity, not per brand owner, so it belongs above the line.
  { id: "ai", label: "Use your AI", path: "/portal/ai", icon: "sparkles", scope: "account" },
  // ── below the switcher: one brand owner at a time ─────────────────────────────────────────────
  // New clearance leads the group because it is the one ACTION here, and it is owner-specific by
  // nature: a run is started for exactly one brand owner, under that owner's framework and defaults.
  { id: "new", label: "New clearance", path: "/portal/new", icon: "plus-circle", scope: "owner" },
  // Reached from a row, never from the sidebar — but it must still RESOLVE, or "Open the report" leads
  // to "That page does not exist." `hidden` keeps it out of the nav while keeping it routable; a screen
  // you can navigate to and a screen you can see in a menu are different questions.
  { id: "result", label: "Clearance", path: "/portal/result", icon: "layers", hidden: true },
  // About — the AGPL §13 source offer. `hidden`, and reached from the AVATAR MENU, which
  // renders on every screen: §13 wants the offer available wherever the user is, and the sidebar is
  // the WORK lane. A sidebar item would rank a licence notice above "New clearance" in the visual
  // hierarchy, which is not what it is for. `hidden` is what keeps it routable — routing is derived
  // from this array, so an entry removed to tidy the sidebar turns the menu link into a dead one.
  { id: "about", label: "About", path: "/portal/about", icon: "info", hidden: true },
  // The brand owner's own configuration. Flat by design: there is no `brand` parent entry, so none of
  // these can be falsely highlighted by a dot-prefix match.
  { id: "brand.profile", label: "Brand profile", path: "/portal/brand/profile", icon: "user", scope: "owner" },
  { id: "brand.projects", label: "Brand projects", path: "/portal/brand/projects", icon: "folder", scope: "owner" },
  { id: "brand.searches", label: "Custom searches", path: "/portal/brand/searches", icon: "bookmark", scope: "owner" },
  // Staff administration, now reached from the AVATAR MENU rather than the sidebar — it is rare, it is
  // not part of the work lane, and it belongs to the person rather than to either scope. `hidden`, not
  // deleted: routing is DERIVED from this array, so removing the entries would not tidy the sidebar, it
  // would turn the avatar menu's links into dead ones. The staff role gate stays exactly as it was.
  {
    id: "admin",
    label: "Admin settings",
    path: "/portal/admin",
    icon: "settings",
    roles: ["staff"],
    hidden: true,
    children: [
      { id: "admin.access", label: "People & access", path: "/portal/admin/access", icon: "users", roles: ["staff"], groupLabel: "Staff" },
      { id: "admin.config", label: "Global config", path: "/portal/admin/config", icon: "server", roles: ["staff"] }
    ]
  },
  // Reached from the avatar menu only — hence `hidden`, not deleted. Routing is DERIVED from this array,
  // so removing the entry would not "take it out of the sidebar", it would turn the avatar menu's link
  // into a dead one. TOP-LEVEL and role-less on purpose: as a child of `admin` (which is staff-gated) it
  // would stop routing for every client, which is precisely who needs it most.
  { id: "preferences", label: "Your preferences", path: "/portal/preferences", icon: "sliders", hidden: true }
];
const visible = (e, role) => !e.roles || e.roles.includes(role);
function navFor(role, entries = NAV) {
  return entries.filter((e) => visible(e, role) && !e.hidden).map(
    (e) => e.children ? { ...e, children: e.children.filter((c) => visible(c, role) && !c.hidden) } : e
  );
}
function navGroupsFor(role, entries = NAV) {
  const visibleEntries = navFor(role, entries);
  return {
    account: visibleEntries.filter((e) => (e.scope ?? "account") === "account"),
    owner: visibleEntries.filter((e) => e.scope === "owner")
  };
}
function scopeOf(id, entries = NAV) {
  if (!id) return "account";
  const hit = flatten(entries).find((e) => e.id === id);
  return (hit == null ? void 0 : hit.scope) === "owner" ? "owner" : "account";
}
function routableFor(role, entries = NAV) {
  return entries.filter((e) => visible(e, role)).map(
    (e) => e.children ? { ...e, children: e.children.filter((c) => visible(c, role)) } : e
  );
}
const flatten = (entries) => entries.flatMap((e) => [e, ...e.children ? flatten(e.children) : []]);
function avatarMenuFor(role, entries = NAV) {
  const all = flatten(routableFor(role, entries));
  const pick = (id) => all.find((e) => e.id === id);
  return [pick("preferences"), pick("admin.access"), pick("admin.config"), pick("about")].filter((e) => !!e);
}
function screenForPath(path, role, entries = NAV) {
  const clean = path.replace(/[?#].*$/, "").replace(/\/+$/, "") || "/portal";
  const all = flatten(routableFor(role, entries));
  const hits = all.filter((e) => clean === e.path || clean.startsWith(e.path + "/"));
  if (!hits.length) return null;
  return hits.reduce((a, b) => b.path.length > a.path.length ? b : a);
}
const HOME = NAV.find((e) => e.id === "home");
const RESULT = NAV.find((e) => e.id === "result");
function resultPath(runId, markSlug = null) {
  const base = `${RESULT.path}/${encodeURIComponent(runId)}`;
  return markSlug === null ? base : `${base}/${encodeURIComponent(markSlug)}`;
}
function resultRoute(pathname) {
  const clean = pathname.replace(/[?#].*$/, "");
  if (!clean.startsWith(RESULT.path + "/")) return { runId: null, markSlug: null };
  const tail = clean.slice(RESULT.path.length + 1).split("/").filter(Boolean);
  const runId = tail[0] ? decode(tail[0]) : null;
  return { runId, markSlug: runId !== null && tail[1] ? decode(tail[1]) : null };
}
function decode(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
const PATHS = {
  layers: "M12 2 2 7l10 5 10-5-10-5ZM2 17l10 5 10-5M2 12l10 5 10-5",
  "plus-circle": "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 8v8M8 12h8",
  sparkles: "M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9L12 3ZM19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2Z",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.4 7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 2.9-1.2V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.2a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.6 1Z",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 16v-4M12 8h.01",
  user: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z",
  users: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8",
  folder: "M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2Z",
  bookmark: "M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2Z",
  sliders: "M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6",
  server: "M20 2H4a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2ZM20 14H4a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2ZM6 6h.01M6 18h.01",
  menu: "M3 12h18M3 6h18M3 18h18",
  x: "M18 6 6 18M6 6l12 12",
  chevron: "m9 18 6-6-6-6",
  "chevron-left": "m15 18-6-6 6-6",
  "chevron-right": "m9 18 6-6-6-6",
  // The six-dot drag handle. Drawn as strokes rather than filled circles so it inherits the same
  // stroke treatment as every other icon here and does not read as a different weight beside them.
  "grip-vertical": "M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01",
  "arrow-right": "M5 12h14M13 6l6 6-6 6",
  trash: "M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM21 21l-4.3-4.3",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7ZM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  "eye-off": "M17.9 17.9A10.4 10.4 0 0 1 12 19c-6 0-10-7-10-7a18 18 0 0 1 5.1-5.9m3.6-1a10.4 10.4 0 0 1 1.3-.1c6 0 10 7 10 7a18 18 0 0 1-2.2 3.2M1 1l22 22M9.9 9.9a3 3 0 0 0 4.2 4.2",
  theme: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 3v18",
  check: "m20 6-11 11-5-5",
  alert: "M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z",
  "panel-left": "M21 3H3a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h18a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2ZM9 3v18"
};
function Icon({ name, size = 17, className }) {
  const d = PATHS[name];
  if (!d) return null;
  return /* @__PURE__ */ jsxRuntimeExports.jsx(
    "svg",
    {
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.6,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      "aria-hidden": "true",
      focusable: "false",
      className,
      style: { flex: "none" },
      children: /* @__PURE__ */ jsxRuntimeExports.jsx("path", { d })
    }
  );
}
const WORDMARK = "clearotron";
function BracketMark({ size = 20 }) {
  return /* @__PURE__ */ jsxRuntimeExports.jsxs(
    "svg",
    {
      viewBox: "0 0 24 24",
      width: size,
      height: size,
      "aria-hidden": "true",
      style: { display: "block", flex: "none" },
      children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("rect", { x: "2", y: "2.6", width: "2", height: "18.8", fill: "currentColor" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("rect", { x: "2", y: "2.6", width: "5.6", height: "2", fill: "currentColor" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("rect", { x: "2", y: "19.4", width: "5.6", height: "2", fill: "currentColor" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("rect", { x: "20", y: "2.6", width: "2", height: "18.8", fill: "currentColor" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("rect", { x: "16.4", y: "2.6", width: "5.6", height: "2", fill: "currentColor" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("rect", { x: "16.4", y: "19.4", width: "5.6", height: "2", fill: "currentColor" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("rect", { x: "10", y: "7.6", width: "4", height: "8.8", fill: "var(--accent)" })
      ]
    }
  );
}
function Logo({ markOnly = false }) {
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { style: { display: "inline-flex", alignItems: "center", gap: 10, whiteSpace: "nowrap" }, children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { color: "var(--text-strong)", display: "block" }, children: /* @__PURE__ */ jsxRuntimeExports.jsx(BracketMark, { size: 20 }) }),
    markOnly ? null : /* @__PURE__ */ jsxRuntimeExports.jsx(
      "span",
      {
        style: {
          fontFamily: "var(--font-mono)",
          fontSize: 15,
          fontWeight: 500,
          letterSpacing: ".02em",
          color: "var(--text-strong)",
          lineHeight: 1,
          whiteSpace: "nowrap"
        },
        children: WORDMARK
      }
    )
  ] });
}
const ACTIVE_MS = 5e3;
const IDLE_MS = 3e4;
const BACKOFF_MS = 6e4;
function useLoad(fetcher, deps) {
  const [result, setResult] = reactExports.useState(null);
  const [loading, setLoading] = reactExports.useState(true);
  const [nonce, setNonce] = reactExports.useState(0);
  const fetcherRef = reactExports.useRef(fetcher);
  fetcherRef.current = fetcher;
  const depsKey = JSON.stringify(deps);
  const seenKey = reactExports.useRef(null);
  reactExports.useEffect(() => {
    let live = true;
    if (seenKey.current !== null && seenKey.current !== depsKey) setResult(null);
    seenKey.current = depsKey;
    setLoading(true);
    void fetcherRef.current().then((r) => {
      if (!live) return;
      setResult(r);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [depsKey, nonce]);
  return { result, loading, reload: reactExports.useCallback(() => setNonce((n) => n + 1), []) };
}
function useVisible() {
  const [visible2, setVisible] = reactExports.useState(() => document.visibilityState !== "hidden");
  reactExports.useEffect(() => {
    const on = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  return visible2;
}
function usePoll(reload, { active: active2, rateLimited }) {
  const visible2 = useVisible();
  const reloadRef = reactExports.useRef(reload);
  reloadRef.current = reload;
  reactExports.useEffect(() => {
    if (!visible2) return;
    const ms = rateLimited ? BACKOFF_MS : active2 ? ACTIVE_MS : IDLE_MS;
    const id = window.setInterval(() => reloadRef.current(), ms);
    return () => window.clearInterval(id);
  }, [visible2, active2, rateLimited]);
  const firstRun = reactExports.useRef(true);
  reactExports.useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    if (visible2) reloadRef.current();
  }, [visible2]);
}
const sources = /* @__PURE__ */ new Set();
function registerGuard(isDirty) {
  sources.add(isDirty);
  return () => {
    sources.delete(isDirty);
  };
}
function hasUnsaved() {
  for (const s of sources) {
    try {
      if (s()) return true;
    } catch {
      return true;
    }
  }
  return false;
}
function confirmDiscard(what = "Leave this page?") {
  if (!hasUnsaved()) return true;
  return window.confirm(`${what}

You have changes here that have not been saved. They will be lost.`);
}
function attachBeforeUnload() {
  const on = (e) => {
    if (!hasUnsaved()) return;
    e.preventDefault();
    e.returnValue = "";
  };
  window.addEventListener("beforeunload", on);
  return () => window.removeEventListener("beforeunload", on);
}
const ALL_OWNERS = "All brand owners";
function ownerNameMap(granted, roster) {
  const out = {};
  for (const [k, v] of Object.entries(granted)) if (k && v) out[k] = v;
  for (const c of roster) if (c.key && c.name) out[c.key] = c.name;
  return out;
}
const ownerNameFrom = (names, key) => key ? names[key] ?? key : ALL_OWNERS;
const sortOwners = (names, keys) => keys.map((k) => ({ key: k, name: ownerNameFrom(names, k) })).sort((a, b) => a.name.localeCompare(b.name));
const MOBILE = "(max-width: 899px)";
function useIsMobile() {
  const [m, setM] = reactExports.useState(() => window.matchMedia(MOBILE).matches);
  reactExports.useEffect(() => {
    const mq = window.matchMedia(MOBILE);
    const on = (e) => setM(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return m;
}
function useTheme() {
  const [theme, setTheme] = reactExports.useState(() => document.documentElement.getAttribute("data-theme") ?? "light");
  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("cordillera-theme", next);
    } catch {
    }
    setTheme(next);
  };
  return [theme, toggle];
}
function usePath() {
  const [loc, setLoc] = reactExports.useState(() => window.location.pathname + window.location.search);
  reactExports.useEffect(() => {
    const on = () => setLoc(window.location.pathname + window.location.search);
    window.addEventListener("popstate", on);
    return () => window.removeEventListener("popstate", on);
  }, []);
  const [visit, setVisit] = reactExports.useState(0);
  const go = (p, opts) => {
    if (!(opts == null ? void 0 : opts.replace) && !confirmDiscard("Leave this page?")) return;
    if (opts == null ? void 0 : opts.replace) window.history.replaceState(null, "", p);
    else window.history.pushState(null, "", p);
    const u = new URL(p, window.location.origin);
    const next = u.pathname + u.search;
    if (next === loc && !(opts == null ? void 0 : opts.replace)) setVisit((n) => n + 1);
    setLoc(next);
  };
  return [loc.replace(/\?.*$/, ""), go, visit];
}
function NavList({
  entries,
  current,
  go,
  collapsed
}) {
  return /* @__PURE__ */ jsxRuntimeExports.jsx(jsxRuntimeExports.Fragment, { children: entries.map((e) => {
    const active2 = current === e.id || ((current == null ? void 0 : current.startsWith(e.id + ".")) ?? false);
    return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs(
        "button",
        {
          type: "button",
          className: `nav-item${active2 ? " active" : ""}`,
          onClick: () => go(e.path),
          "aria-current": active2 ? "page" : void 0,
          title: collapsed ? e.label : void 0,
          children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(Icon, { name: e.icon }),
            collapsed ? null : /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: e.label })
          ]
        }
      ),
      e.children && active2 && !collapsed ? /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "nav-sub", children: e.children.map((c) => /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
        c.groupLabel ? /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "eyebrow nav-group", children: c.groupLabel }) : null,
        /* @__PURE__ */ jsxRuntimeExports.jsx(
          "button",
          {
            type: "button",
            className: `nav-item${current === c.id ? " active" : ""}`,
            onClick: () => go(c.path),
            "aria-current": current === c.id ? "page" : void 0,
            children: /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: c.label })
          }
        )
      ] }, c.id)) }) : null
    ] }, e.id);
  }) });
}
function SessionEnded() {
  return /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "screen", children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "notice", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx("h1", { style: { fontSize: 19, margin: "0 0 8px" }, children: "Your session has ended" }),
    /* @__PURE__ */ jsxRuntimeExports.jsx("p", { style: { margin: "0 0 12px", color: "var(--text-muted)" }, children: "Nothing is wrong with this install and nothing has been lost — signing in again brings you straight back to your clearances." }),
    /* @__PURE__ */ jsxRuntimeExports.jsx("a", { className: "btn-primary", href: "/portal", style: { display: "inline-block", textDecoration: "none" }, children: "Sign in again" })
  ] }) });
}
function AppShell({ render: render2 }) {
  const [path, go, visit] = usePath();
  const [theme, toggleTheme] = useTheme();
  const [collapsed, setCollapsed] = reactExports.useState(false);
  const [drawer, setDrawer] = reactExports.useState(false);
  const [anon, setAnon] = reactExports.useState(false);
  const [avatarOpen, setAvatarOpen] = reactExports.useState(false);
  const [owner, setOwner] = reactExports.useState(null);
  const setOwnerGuarded = reactExports.useCallback((next) => {
    if (!confirmDiscard("Switch brand owner?")) return;
    setOwner(next);
  }, []);
  reactExports.useEffect(() => attachBeforeUnload(), []);
  const mobile = useIsMobile();
  const { result: meResult, loading } = useLoad(() => api.me(), []);
  const [sessionEnded, setSessionEnded] = reactExports.useState(false);
  reactExports.useEffect(() => onSessionEnded(() => setSessionEnded(true)), []);
  const sole = (meResult == null ? void 0 : meResult.kind) === "ok" && !meResult.value.allAccounts && meResult.value.accounts.length === 1 ? meResult.value.accounts[0] ?? null : null;
  const isStaff = (meResult == null ? void 0 : meResult.kind) === "ok" && meResult.value.role === "staff";
  const { result: rosterResult } = useLoad(
    () => isStaff ? api.roster() : Promise.resolve({ kind: "ok", value: [] }),
    [isStaff]
  );
  reactExports.useEffect(() => {
    document.documentElement.classList.toggle("anon-on", anon);
  }, [anon]);
  reactExports.useEffect(() => {
    setDrawer(false);
    setAvatarOpen(false);
  }, [path]);
  if (loading) return /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "screen" });
  if (sessionEnded || meResult && meResult.kind === "signedOut") return /* @__PURE__ */ jsxRuntimeExports.jsx(SessionEnded, {});
  if (!meResult || meResult.kind !== "ok") {
    return /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "screen", children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "notice", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("h1", { style: { fontSize: 19, margin: "0 0 8px" }, children: "No clearances are available to you" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("p", { style: { margin: 0, color: "var(--text-muted)" }, children: "You are signed in, but this address has not been enrolled for any account yet. Enrolment can be arranged — it is two-sided, so it needs doing in two places." })
    ] }) });
  }
  const me = meResult.value;
  const role = me.role;
  const groups = navGroupsFor(role);
  const entry = screenForPath(path, role) ?? (path === "/portal" || path === "/portal/" ? HOME : null);
  const names = ownerNameMap(me.accountNames, (rosterResult == null ? void 0 : rosterResult.kind) === "ok" ? rosterResult.value : []);
  const ownerName = (key) => ownerNameFrom(names, key);
  const ownerKeys = role === "staff" ? (rosterResult == null ? void 0 : rosterResult.kind) === "ok" ? rosterResult.value.map((c) => c.key) : [] : me.accounts;
  const ownerInView = owner ?? sole;
  const body = entry ? render2(entry.id, { me, owner: ownerInView, setOwner: setOwnerGuarded, ownerName, ownerKeys, go, visit }) : (
    // An unknown path and a staff-only path a client typed both land here, indistinguishably.
    /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "screen", children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "empty", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("p", { children: "That page does not exist." }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("button", { type: "button", className: "nav-item", style: { width: "auto", margin: "0 auto" }, onClick: () => go(HOME.path), children: [
        "Back to ",
        HOME.label
      ] })
    ] }) })
  );
  const multiOwner = me.allAccounts || me.accounts.length > 1;
  const accountName = role === "staff" ? me.brand || null : me.accounts.length === 1 ? ownerName(me.accounts[0]) : null;
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "app", children: [
    mobile && drawer ? /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "scrim", "aria-label": "Close menu", onClick: () => setDrawer(false) }) : null,
    /* @__PURE__ */ jsxRuntimeExports.jsxs("nav", { className: `sidebar${collapsed && !mobile ? " collapsed" : ""}${drawer ? " open" : ""}`, "aria-label": "Main", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "sidebar-head", children: /* @__PURE__ */ jsxRuntimeExports.jsx(
        "button",
        {
          type: "button",
          className: "nav-item",
          style: { padding: "4px 6px" },
          onClick: () => go(HOME.path),
          "aria-label": `${WORDMARK} — go to ${HOME.label.toLowerCase()}`,
          children: /* @__PURE__ */ jsxRuntimeExports.jsx(Logo, { markOnly: collapsed && !mobile })
        }
      ) }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "sidebar-scroll", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(NavList, { entries: groups.account, current: (entry == null ? void 0 : entry.id) ?? null, go, collapsed: collapsed && !mobile }),
        groups.owner.length ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { marginTop: 18 }, children: [
          collapsed && !mobile ? (
            // Collapsed to icons there is no room for a control, and a switcher that silently
            // disappeared would leave the group below it looking unscoped. A rule stands in for it:
            // the boundary survives even when the label cannot.
            /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { height: 1, background: "var(--border-hairline)", margin: "0 8px 12px" } })
          ) : (
            // NOTHING AT ALL WHEN THERE IS NOTHING TO SWITCH. A single-owner identity IS its own
            // brand owner, so naming it here would print that name a third time on one screen —
            // rail, title and Account corner — and a label repeated three times stops being read
            // anywhere. It would also label a distinction that does not exist for them: with one
            // owner there is no "which owner", so the group needs no header to disambiguate.
            // Quantity is a rendering decision, never a layout.
            multiOwner ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { marginBottom: 10 }, children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "eyebrow", children: "Brand owner" }),
              /* @__PURE__ */ jsxRuntimeExports.jsx(BrandOwnerSwitcher, { keys: ownerKeys, ownerName, value: owner, onChange: setOwnerGuarded })
            ] }) : null
          ),
          /* @__PURE__ */ jsxRuntimeExports.jsx(NavList, { entries: groups.owner, current: (entry == null ? void 0 : entry.id) ?? null, go, collapsed: collapsed && !mobile })
        ] }) : null
      ] }),
      !mobile ? /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "sidebar-foot", children: /* @__PURE__ */ jsxRuntimeExports.jsxs("button", { type: "button", className: "nav-item", onClick: () => setCollapsed((c) => !c), children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(Icon, { name: "panel-left" }),
        collapsed ? null : /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "Collapse" })
      ] }) }) : null
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "main", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("header", { className: "topbar", children: [
        mobile ? /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "icon-btn", "aria-label": "Open menu", onClick: () => setDrawer(true), children: /* @__PURE__ */ jsxRuntimeExports.jsx(Icon, { name: "menu" }) }) : null,
        /* @__PURE__ */ jsxRuntimeExports.jsx("h1", { "data-anon": "mark", children: !entry ? "Not found" : scopeOf(entry.id) === "owner" ? ownerName(ownerInView) : accountName ?? ownerName(ownerInView) }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { marginLeft: "auto", display: "flex", alignItems: "center", gap: 4, position: "relative" }, children: [
          !mobile && accountName ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { textAlign: "right", marginRight: 8, minWidth: 0 }, children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "eyebrow", children: "Account" }),
            /* @__PURE__ */ jsxRuntimeExports.jsx(
              "div",
              {
                style: { fontWeight: 700, color: "var(--text-strong)", fontSize: 14, lineHeight: 1.2, whiteSpace: "nowrap" },
                "data-anon": "mark",
                children: accountName
              }
            )
          ] }) : null,
          /* @__PURE__ */ jsxRuntimeExports.jsx(
            "button",
            {
              type: "button",
              className: "icon-btn",
              "aria-pressed": anon,
              "aria-label": "Blur names for screen sharing",
              title: "Blur names for screen sharing",
              onClick: () => setAnon((a) => !a),
              children: /* @__PURE__ */ jsxRuntimeExports.jsx(Icon, { name: anon ? "eye-off" : "eye" })
            }
          ),
          /* @__PURE__ */ jsxRuntimeExports.jsx(
            "button",
            {
              type: "button",
              className: "icon-btn",
              "aria-pressed": theme === "dark",
              "aria-label": "Switch light or dark theme",
              title: "Switch light or dark theme",
              onClick: toggleTheme,
              children: /* @__PURE__ */ jsxRuntimeExports.jsx(Icon, { name: "theme" })
            }
          ),
          /* @__PURE__ */ jsxRuntimeExports.jsx(
            "button",
            {
              type: "button",
              className: "icon-btn",
              "aria-haspopup": "menu",
              "aria-expanded": avatarOpen,
              "aria-label": "Account menu",
              style: { borderRadius: "50%", background: "var(--surface-float)", border: "1px solid var(--border-hairline)", fontSize: 11, fontWeight: 700 },
              onClick: () => setAvatarOpen((o) => !o),
              children: initials(me.email)
            }
          ),
          avatarOpen ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "float", role: "menu", style: { position: "absolute", right: 0, top: 40, width: 240, padding: 6, zIndex: 50 }, children: [
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { padding: "8px 10px", borderBottom: "1px solid var(--border-hairline)" }, children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "eyebrow", children: "Signed in as" }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { fontSize: 13, wordBreak: "break-all" }, "data-anon": "mark", children: me.email }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { fontSize: 12, color: "var(--text-muted)", marginTop: 2 }, children: role === "staff" ? staffLabel(me.brand) : "Client" })
            ] }),
            avatarMenuFor(role).map((e) => /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
              e.groupLabel ? /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "eyebrow nav-group", style: { padding: "8px 10px 2px" }, children: e.groupLabel }) : null,
              /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "nav-item", role: "menuitem", onClick: () => go(e.path), children: e.label })
            ] }, e.id)),
            /* @__PURE__ */ jsxRuntimeExports.jsx("a", { className: "nav-item", role: "menuitem", href: "/portal/sign-out", children: "Log out" })
          ] }) : null
        ] })
      ] }),
      body
    ] })
  ] });
}
function BrandOwnerSwitcher({
  keys,
  ownerName,
  value,
  onChange
}) {
  const options = sortOwners(Object.fromEntries(keys.map((k) => [k, ownerName(k)])), keys);
  return /* @__PURE__ */ jsxRuntimeExports.jsxs(
    "select",
    {
      value: value ?? "",
      onChange: (e) => onChange(e.target.value || null),
      "aria-label": "Brand owner",
      style: {
        width: "100%",
        marginTop: 4,
        padding: "6px 9px",
        borderRadius: 8,
        border: "1px solid var(--border-hairline)",
        background: "var(--surface-raised)",
        // Set at the weight of a heading rather than of a form field. This is the single most
        // load-bearing piece of context on the page — which client's world you are looking at — and at
        // the browser's default select type it read as a filter dropdown somebody had left in the rail.
        fontSize: 15,
        fontWeight: 700,
        color: "var(--text-strong)"
      },
      children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("option", { value: "", children: ALL_OWNERS }),
        options.map((o) => /* @__PURE__ */ jsxRuntimeExports.jsx("option", { value: o.key, children: o.name }, o.key))
      ]
    }
  );
}
const initials = (email) => {
  var _a, _b;
  const name = email.split("@")[0] ?? "";
  const parts = name.split(/[._-]+/).filter(Boolean);
  const letters = parts.length >= 2 ? `${((_a = parts[0]) == null ? void 0 : _a[0]) ?? ""}${((_b = parts[1]) == null ? void 0 : _b[0]) ?? ""}` : name.slice(0, 2);
  return letters.toUpperCase();
};
function markKey(name) {
  return name.trim().toLowerCase();
}
function displayName(run) {
  var _a;
  const typed = (_a = run.markName) == null ? void 0 : _a.trim();
  if (typed) return typed;
  const named = (run.marks ?? []).map((m) => {
    var _a2;
    return (_a2 = m.name) == null ? void 0 : _a2.trim();
  }).filter((n) => !!n);
  if (named.length === 1) return named[0];
  if (named.length > 1) return `${named[0]} +${named.length - 1} more`;
  return run.title;
}
function inSentence(name, max = 60) {
  const one = String(name ?? "").replace(/\s+/g, " ").trim();
  if (one.length <= max) return one;
  const cut = one.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
const newestFirst = (a, b) => String(b.issuedAt ?? "").localeCompare(String(a.issuedAt ?? "")) || String(b.date ?? "").localeCompare(String(a.date ?? ""));
function openDocument(run, markSlug) {
  if (markSlug === null) return { doc: run.report, mark: null, missing: false };
  const picked = run.reports.find((r) => r.slug === markSlug) ?? null;
  return { doc: (picked == null ? void 0 : picked.path) ?? null, mark: (picked == null ? void 0 : picked.mark) ?? null, missing: picked === null };
}
function showsAssessment(run, markSlug) {
  const { doc, missing } = openDocument(run, markSlug);
  return doc === null && !missing && run.reports.length > 0;
}
function readsFor(runs, current) {
  const key = markKey(displayName(current));
  return runs.filter((r) => r.account === current.account && markKey(displayName(r)) === key).sort(newestFirst);
}
function hasThread(reads) {
  return reads.length > 1;
}
function readTime(run) {
  const t = run.issuedAt;
  if (!t) return "";
  const m = /^\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2})/.exec(t);
  return m ? `${m[1]}:${m[2]}` : "";
}
function readLabel(run) {
  const head = run.productName || run.stageLabel;
  if (head && run.date) return `${head} · ${run.date}`;
  return head ?? run.date ?? run.runId.slice(0, 12);
}
const NO_FAMILIES = { of: {}, names: {} };
function bandsPresent(bands, labels) {
  const seen = [];
  for (const l of labels) if (typeof l === "string" && l && !seen.includes(l)) seen.push(l);
  return seen.sort((x, y) => bandRank(bands, x) - bandRank(bands, y));
}
function marksOf(runs, families = NO_FAMILIES) {
  const byKey = /* @__PURE__ */ new Map();
  for (const run of runs) {
    const key = `${run.account}\0${markKey(displayName(run))}`;
    const bucket = byKey.get(key);
    if (bucket) bucket.push(run);
    else byKey.set(key, [run]);
  }
  const out = [];
  for (const [id, bucket] of byKey) {
    const reads = [...bucket].sort(newestFirst);
    const current = reads[0];
    const rowBands = bandsPresent(
      current.bands,
      current.marks.length ? current.marks.map((m) => m.band) : [current.band]
    );
    const worstEarlier = reads.slice(1).reduce(
      (w, r) => r.band && (w === null || bandRank(current.bands, r.band) < bandRank(current.bands, w)) ? r.band : w,
      null
    );
    const improvedFrom = worstEarlier && current.band && bandRank(current.bands, worstEarlier) < bandRank(current.bands, current.band) ? worstEarlier : null;
    out.push({
      kind: "mark",
      id,
      account: current.account,
      name: displayName(current),
      reads,
      current,
      // The row speaks for the latest read, so it borrows that read's band and date wholesale rather
      // than computing anything. A run still in flight has no band, and the row says so too.
      band: current.band,
      tone: current.tone,
      date: current.date,
      issuedAt: current.issuedAt,
      bands: current.bands,
      rowBands,
      improvedFrom,
      state: current.state,
      // A family is asserted per RUN, so a mark belongs to whichever family any of its reads names.
      // Newest wins, which is what re-filing a mark looks like from the outside.
      familyId: reads.map((r) => families.of[r.runId]).find((f) => typeof f === "string") ?? null
    });
  }
  return out;
}
function rowsOf(marks, families = NO_FAMILIES) {
  const rows = [];
  const at = /* @__PURE__ */ new Map();
  for (const mark of marks) {
    const fid = mark.familyId;
    if (!fid) {
      rows.push(mark);
      continue;
    }
    const seen = at.get(fid);
    if (seen === void 0) {
      at.set(fid, rows.length);
      rows.push({
        kind: "family",
        id: fid,
        account: mark.account,
        name: families.names[fid] ?? fid,
        marks: [mark],
        band: null,
        tone: null,
        bands: [],
        date: null,
        issuedAt: null,
        state: "delivered"
      });
    } else {
      const fam = rows[seen];
      rows[seen] = { ...fam, marks: [...fam.marks, mark] };
    }
  }
  return rows.map((row) => row.kind === "family" ? rolledUp(row) : row);
}
function rolledUp(fam) {
  var _a, _b, _c;
  const ladder = ((_a = fam.marks.find((m) => m.current.bands.length)) == null ? void 0 : _a.current.bands) ?? [];
  const labels = fam.marks.map((m) => m.band);
  const band = ladder.length ? worstBand(ladder, labels) : null;
  return {
    ...fam,
    band,
    tone: band ? ((_b = ladder.find((b) => b.label === band)) == null ? void 0 : _b.tone) ?? null : null,
    bands: ladder,
    date: fam.marks.map((m) => m.date).reduce((a, b) => String(b ?? "") > String(a ?? "") ? b : a, null),
    // The same max over the marks, on the precise field. Computed beside `date` rather than derived from
    // it, because a family's newest mark by day and by second can be different marks.
    issuedAt: fam.marks.map((m) => m.issuedAt).reduce((a, b) => String(b ?? "") > String(a ?? "") ? b : a, null),
    // Finished only when all of it is. A family reported as delivered while one of its names is still
    // running invites someone to read a conclusion that is still being written.
    state: ((_c = fam.marks.find((m) => m.state !== "delivered")) == null ? void 0 : _c.state) ?? "delivered"
  };
}
const STAGE_PHRASE = {
  "matter-frame": "while framing the matter",
  "prelim-variants": "while working out which variants to search",
  "blind-frame": "while framing the matter",
  "common-law": "during the common-law search",
  "common-law-half": "during the common-law search",
  "register-unit": "during the register search",
  "frame-diff": "while reconciling what the searches found",
  "placement-inquiry": "while placing what the searches found",
  "register-digest": "while reading the register results",
  "skeptic": "while checking its own reasoning",
  "synthesis": "while forming the opinion",
  "case-law": "during the case-law search",
  "narrative-refutation": "while testing the opinion against the evidence",
  "report-overview": "while writing the report",
  "report-card": "while writing the report",
  "doubt-closure": "while closing an open question"
  // — the three send stages had phrases here and are DELETED with them, deliberately and not by
  // the reasoning progress.mjs uses one directory over. There, a retired stage's step is KEPT because a
  // status row that resolves to no step renders as an unlabelled gap. Here the fallback is already
  // correct: an unmapped stage yields `Not finished. It cannot be resumed from here.` and never renders
  // the id, which is the whole job of this table. An archived run that failed in one of those stages
  // loses one clause of context and leaks nothing — and the bijection in failure.test.ts refuses a
  // phrase naming a stage the engine no longer has, which is the property worth keeping.
};
const FAIL_KINDS = [
  [/^timeout\b/, "A step ran out of time."],
  [/^lane_wedge\b/, "A search lane stopped responding."],
  [/^embedded_fallback\b/, "A search returned a stand-in answer instead of a real one."],
  [/^nonzero_exit_\d+\b/, "A step exited with an error."],
  [/^unparseable_json\b/, "A step returned something the engine could not read."],
  [/^status_/, "A step reported an unexpected state."],
  [/^missing_file:/, "A step did not produce a result it was supposed to."],
  [/^invalid_file:/, "A step produced a result that did not pass its own checks."]
];
const LOOKS_INTERNAL = /[/\\]|\.(?:md|json|html|jsonl|xlsx)\b|^tmp|[a-z]+_[a-z]+|\w:\S|::/;
function readableFailure(failedStage, reason) {
  var _a;
  const stage = String(failedStage ?? "").split(":")[0] ?? "";
  const phrase = STAGE_PHRASE[stage] ?? null;
  const raw = typeof reason === "string" && reason.trim() ? reason.trim() : null;
  const kind = raw ? ((_a = FAIL_KINDS.find(([re]) => re.test(raw))) == null ? void 0 : _a[1]) ?? null : null;
  const headline = phrase ? `Not finished — stopped ${phrase}. It cannot be resumed from here.` : "Not finished. It cannot be resumed from here.";
  const detail = kind ?? (raw && !LOOKS_INTERNAL.test(raw) && raw.length <= 140 ? raw : null);
  return { headline, detail, raw };
}
const RANK = { failed: 0, running: 1, paused: 2, queued: 3 };
function inFlight(runs) {
  return runs.filter((r) => r.state !== "delivered" && !r.acked).slice().sort((a, b) => (RANK[a.state] ?? 9) - (RANK[b.state] ?? 9));
}
function acknowledged(runs) {
  return runs.filter((r) => r.state !== "delivered" && r.acked).slice().sort((a, b) => (RANK[a.state] ?? 9) - (RANK[b.state] ?? 9));
}
function recentlyFinished(runs, families = NO_FAMILIES, limit = 3) {
  const rows = rowsOf(marksOf(runs.filter((r) => r.state === "delivered"), families), families);
  return [...rows].sort(newestFirst).slice(0, limit);
}
const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven"];
const count = (n) => n < WORDS.length ? WORDS[n] : String(n);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const slotNote = (busy, slots) => {
  if (slots == null) return null;
  const c = `${count(slots)} run${slots === 1 ? "" : "s"} at once, across all brand owners`;
  return busy == null ? cap(c) : `${busy} of ${slots} running · ${c}`;
};
function elapsed(startedAt, now = Date.now()) {
  if (!startedAt) return null;
  const t = Date.parse(startedAt);
  if (Number.isNaN(t)) return null;
  const mins = Math.floor((now - t) / 6e4);
  if (mins < 1) return "just started";
  if (mins < 60) return `${mins} min so far`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m so far` : `${h}h so far`;
}
function pips(stepN, stepTotal) {
  if (stepTotal == null || !Number.isFinite(stepTotal) || stepTotal < 1) return null;
  const total = Math.floor(stepTotal);
  const filled = Math.max(0, Math.min(total, Math.floor(stepN ?? 0)));
  return { total, filled };
}
const active = (rows) => rows.filter((r) => r.state !== "queued");
const waiting = (rows) => rows.filter((r) => r.state === "queued").slice().sort((a, b) => (a.queuePos ?? 1e9) - (b.queuePos ?? 1e9));
function runProductLabel(productName, markCount = 0) {
  if (!productName) return null;
  return markCount > 1 ? `${productName} · ${markCount} names` : productName;
}
function cardReason(r, now = Date.now()) {
  if (r.state === "failed") return readableFailure(r.failedStage, r.reason).headline;
  if (r.state === "cancelled") return "Stopped before it finished. Nothing was delivered.";
  if (r.state === "paused") {
    if (r.pausedKind === "rate-limit" && r.resetsAt) {
      const t = Date.parse(r.resetsAt);
      if (!Number.isNaN(t)) return `Provider cap — resumes ${new Date(t).toISOString().slice(11, 16)} UTC`;
    }
    if (r.pausedKind === "recovering") return "Retrying after a problem";
    if (r.pausedKind === "operator") return "Paused by a system restart — resumes on its own";
    return "Waiting on a provider cap";
  }
  return elapsed(r.startedAt, now);
}
function limitLine(used, limit) {
  if (limit == null) return used == null ? "Daily allowance unavailable" : `${used} run${used === 1 ? "" : "s"} today`;
  if (limit === 0) return "No daily cap on this account";
  return `${used ?? 0} of ${limit} run${limit === 1 ? "" : "s"} used today · resets midnight UTC`;
}
function moveBefore(order, id, over) {
  if (id === over) return order;
  const from = order.indexOf(id);
  const to = order.indexOf(over);
  if (from < 0 || to < 0) return order;
  const next = [...order];
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}
const TERMINAL$1 = /* @__PURE__ */ new Set(["delivered", "failed", "cancelled"]);
function lastFinishedOf(row) {
  if (row.kind === "mark") {
    return { name: row.name, band: row.band, tone: row.tone, account: row.account, date: row.date, runId: row.current.runId };
  }
  const newest = row.marks[0];
  if (!newest) return null;
  return { name: row.name, band: row.band, tone: row.tone, account: row.account, date: row.date, runId: newest.current.runId };
}
function Home({ ctx }) {
  const { result, reload } = useLoad(() => api.runsMine(), []);
  const allowanceOwner = ctx.owner ?? (ctx.me.accounts.length === 1 ? ctx.me.accounts[0] : null);
  const { result: usageRes } = useLoad(
    () => allowanceOwner ? api.usage(allowanceOwner) : Promise.resolve({ kind: "pickAccount" }),
    [allowanceOwner]
  );
  const runs = (result == null ? void 0 : result.kind) === "ok" ? result.value : [];
  const rows = reactExports.useMemo(() => inFlight(runs), [runs]);
  const acked = reactExports.useMemo(() => acknowledged(runs), [runs]);
  const [showAcked, setShowAcked] = reactExports.useState(false);
  const cards = reactExports.useMemo(() => active(rows), [rows]);
  const queue = reactExports.useMemo(() => waiting(rows), [rows]);
  const done = reactExports.useMemo(() => recentlyFinished(runs, void 0, 1), [runs]);
  const lastDone = reactExports.useMemo(() => done.length ? lastFinishedOf(done[0]) : null, [done]);
  usePoll(reload, {
    active: runs.some((r) => !TERMINAL$1.has(r.state)),
    rateLimited: (result == null ? void 0 : result.kind) === "rateLimited"
  });
  const answer = !result ? "loading" : result.kind === "ok" ? "ok" : "error";
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "screen home2", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx(
      InFlightBand,
      {
        count: cards.length + queue.length,
        note: slotNote(null, ctx.me.concurrentRuns),
        onNew: () => ctx.go("/portal/new")
      }
    ),
    answer === "error" ? /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "home2-notice", children: (result == null ? void 0 : result.kind) === "rateLimited" ? "Too many requests just now. The portal is pacing itself; this will refresh on its own." : "This did not load. Nothing is wrong with your runs — the list will try again." }) : null,
    cards.length ? /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "home2-cards", children: cards.map((r) => /* @__PURE__ */ jsxRuntimeExports.jsx(Card, { run: r, ctx, onChanged: reload }, r.runId)) }) : null,
    queue.length ? /* @__PURE__ */ jsxRuntimeExports.jsx(Queue, { rows: queue, ctx, onChanged: reload }) : null,
    acked.length ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "home2-acked", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs(
        "button",
        {
          type: "button",
          className: "home2-acked-toggle",
          "aria-expanded": showAcked,
          onClick: () => setShowAcked((v) => !v),
          children: [
            acked.length,
            " acknowledged",
            showAcked ? "" : " — show"
          ]
        }
      ),
      showAcked ? /* @__PURE__ */ jsxRuntimeExports.jsx("ul", { className: "home2-acked-list", children: acked.map((r) => /* @__PURE__ */ jsxRuntimeExports.jsxs("li", { children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { "data-anon": "mark", children: displayName(r) }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "home2-acked-state", children: r.state === "failed" ? "Not finished" : "Stopped" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(AckUndo, { run: r, onChanged: reload })
      ] }, r.runId)) }) : null
    ] }) : null,
    lastDone ? /* @__PURE__ */ jsxRuntimeExports.jsx(LastFinished, { row: lastDone, ctx }) : null,
    answer === "ok" && !cards.length && !queue.length && !lastDone ? /* @__PURE__ */ jsxRuntimeExports.jsx(FirstRun$1, { onNew: () => ctx.go("/portal/new") }) : null,
    (usageRes == null ? void 0 : usageRes.kind) === "ok" ? /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "home2-limits mono", children: limitLine(usageRes.value.today, usageRes.value.dailyRuns) }) : null
  ] });
}
function InFlightBand({
  count: count2,
  note,
  onNew
}) {
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "home2-band", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "home2-band-label", children: "In flight" }),
    /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "home2-band-count mono", children: count2 }),
    /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "home2-band-rule" }),
    /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "home2-band-note", children: note }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("button", { type: "button", className: "home2-new", onClick: onNew, children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx(Icon, { name: "plus-circle" }),
      "New clearance"
    ] })
  ] });
}
function Card({
  run,
  ctx,
  onChanged
}) {
  const [busy, setBusy] = reactExports.useState(false);
  const [failed, setFailed] = reactExports.useState(null);
  const [asking, setAsking] = reactExports.useState(false);
  const [took, setTook] = reactExports.useState(null);
  const p = pips(run.stepN, run.stepTotal);
  const label = runProductLabel(run.productName, run.marks.length);
  const reason = cardReason(run);
  const canStop = run.state === "running" || run.state === "paused";
  const stopping = Boolean(run.stopRequestedAt) && canStop;
  const canAck = run.state === "failed" || run.state === "cancelled";
  const ack = reactExports.useCallback(async (acknowledged2) => {
    setBusy(true);
    setFailed(null);
    const r = await api.acknowledge({ runId: run.runId, state: run.state, acknowledged: acknowledged2 });
    setBusy(false);
    if (r.kind !== "ok") {
      setFailed(saveFailureText(r, "That could not be saved just now. Nothing has changed."));
      return;
    }
    onChanged();
  }, [run, onChanged]);
  const stop = reactExports.useCallback(async (immediate) => {
    setAsking(false);
    setBusy(true);
    setFailed(null);
    const r = await api.stopRun(run.runId, run.account, { immediate });
    setBusy(false);
    if (r.kind !== "ok") {
      setFailed(saveFailureText(r, "It could not be stopped just now. Nothing has changed."));
    } else {
      setTook(r.value);
    }
    onChanged();
  }, [run, onChanged]);
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: `home2-card${run.state === "failed" ? " failed" : ""}`, children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: `home2-card-rule ${run.state}` }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "home2-card-body", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "home2-card-head", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "home2-depth", children: label }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(StateChip, { state: run.state, stopping })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "home2-card-mark", "data-anon": "mark", children: displayName(run) }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "home2-card-owner", "data-anon": "mark", children: [
        ctx.ownerName(run.account),
        run.projectName || run.projectKey ? ` · ${run.projectName ?? run.projectKey}` : ""
      ] }),
      run.step ? /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "home2-step", children: run.step }) : null,
      p ? /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "home2-pips", children: Array.from({ length: p.total }, (_, i) => /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: `home2-pip${i < p.filled ? ` on ${run.state}` : ""}` }, i)) }) : null,
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "home2-card-foot", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: `home2-reason ${run.state}`, children: failed ?? reason }),
        run.state === "failed" && (run.reasonDetail ?? readableFailure(run.failedStage, run.reason).raw) ? /* @__PURE__ */ jsxRuntimeExports.jsxs("details", { className: "home2-raw", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("summary", { style: { cursor: "pointer", color: "var(--text-faint)", fontSize: 12 }, children: "Details" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("pre", { style: { whiteSpace: "pre-wrap", margin: "4px 0 0", fontSize: 11, color: "var(--text-muted)" }, children: run.reasonDetail ?? readableFailure(run.failedStage, run.reason).raw })
        ] }) : null,
        canStop && !stopping ? ctx.me.stopControl.available ? /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "home2-stop", onClick: () => setAsking(true), disabled: busy, children: busy ? "Stopping…" : "Stop" }) : (
          /* — a button that always fails must not render as available. The
             deployment said at boot its token cannot stop; the control says so here, where the
             press would have happened, instead of failing identically forever. Staff read the
             posture reason; a client reads who to ask. */
          /* Its OWN class, deliberately (the Acknowledge lesson one arm up): home2-stop is counted
             by the browser check as "a Stop that can act", and this control exists precisely
             because this one cannot. */
          /* @__PURE__ */ jsxRuntimeExports.jsx(
            "button",
            {
              type: "button",
              className: "home2-stop-unavailable",
              disabled: true,
              title: ctx.me.stopControl.reason ?? "Stopping is not available on this deployment right now — the operator has been told at boot.",
              children: "Stop unavailable"
            }
          )
        ) : null,
        asking ? /* @__PURE__ */ jsxRuntimeExports.jsx(
          StopChoice,
          {
            name: displayName(run),
            step: run.step,
            onImmediate: () => void stop(true),
            onBoundary: () => void stop(false),
            onCancel: () => setAsking(false)
          }
        ) : null,
        stopping ? (
          /* The wait, named: what is finishing and why it is allowed to — the
             answer to "why is this taking so long", which the reader cannot otherwise know. The
             button is GONE, not disabled-and-grey: there is nothing further to press for. */
          /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "home2-stopping", children: (took == null ? void 0 : took.note) ? took.note : /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
            "Stopping — ",
            run.step ? `letting “${run.step}” finish` : "letting the step in flight finish",
            ". A reasoning step can take tens of minutes and has no deadline. Nothing further will start, and nothing will be delivered."
          ] }) })
        ) : null,
        canAck ? /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "home2-ack", onClick: () => void ack(true), disabled: busy, children: "Acknowledge" }) : null
      ] })
    ] })
  ] });
}
function AckUndo({ run, onChanged }) {
  const [busy, setBusy] = reactExports.useState(false);
  return /* @__PURE__ */ jsxRuntimeExports.jsx(
    "button",
    {
      type: "button",
      className: "home2-acked-undo",
      disabled: busy,
      onClick: async () => {
        setBusy(true);
        await api.acknowledge({ runId: run.runId, state: run.state, acknowledged: false });
        setBusy(false);
        onChanged();
      },
      children: "Bring back"
    }
  );
}
function StopChoice({ name, step, onImmediate, onBoundary, onCancel }) {
  reactExports.useEffect(() => {
    const on = (e) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [onCancel]);
  return /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "modal-scrim", onClick: onCancel, role: "dialog", "aria-modal": "true", "aria-label": "Stop this clearance", children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "modal-card", onClick: (e) => e.stopPropagation(), children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "modal-head", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "modal-rule", "aria-hidden": true }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "eyebrow", style: { color: "var(--accent-quiet)" }, children: "Stop this clearance" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("h2", { style: { margin: "7px 0 3px", fontSize: 19, fontWeight: 700, color: "var(--text-strong)" }, "data-anon": "mark", children: name }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("p", { style: { margin: 0, fontSize: 12.5, color: "var(--text-muted)" }, children: "Either way it cannot be undone, nothing is delivered, and what has already been spent is spent." })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "stop-choice", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("button", { type: "button", className: "stop-choice-opt", onClick: onBoundary, children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("b", { children: "Stop at the next step" }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { children: [
          step ? /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
            "Lets “",
            step,
            "” finish first, so its work is kept."
          ] }) : /* @__PURE__ */ jsxRuntimeExports.jsx(jsxRuntimeExports.Fragment, { children: "Lets the step in flight finish first, so its work is kept." }),
          " ",
          "That step has no deadline — it ends when it ends, and it can be tens of minutes."
        ] })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("button", { type: "button", className: "stop-choice-opt stop-choice-now", onClick: onImmediate, children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("b", { children: "Stop now" }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { children: [
          "Ends ",
          step ? /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
            "“",
            step,
            "”"
          ] }) : /* @__PURE__ */ jsxRuntimeExports.jsx(jsxRuntimeExports.Fragment, { children: "the step in flight" }),
          " rather than waiting for it. The run is over in seconds. That step’s work is lost; everything recorded before it is kept."
        ] })
      ] })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "modal-foot", children: /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "btn-ghost", onClick: onCancel, children: "Leave it running" }) })
  ] }) });
}
function StateChip({ state, stopping = false }) {
  const word = stopping ? "Stopping…" : state === "running" ? "Running" : state === "paused" ? "Paused" : state === "failed" ? "Not finished" : "Stopped";
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: `home2-chip ${state}`, children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "home2-dot" }),
    word
  ] });
}
function Queue({
  rows,
  ctx,
  onChanged
}) {
  const [open, setOpen] = reactExports.useState(false);
  const [order, setOrder] = reactExports.useState(() => rows.map((r) => r.runId));
  const [dragging, setDragging] = reactExports.useState(null);
  const [over, setOver] = reactExports.useState(null);
  const ids = rows.map((r) => r.runId).join(",");
  reactExports.useEffect(() => setOrder(rows.map((r) => r.runId)), [ids]);
  const byId = new Map(rows.map((r) => [r.runId, r]));
  const shown = order.map((id) => byId.get(id)).filter((r) => !!r);
  const commit = reactExports.useCallback(
    async (next) => {
      var _a;
      setOrder(next);
      const account = (_a = shown[0]) == null ? void 0 : _a.account;
      if (!account) return;
      await api.reorderQueue(next, account);
      onChanged();
    },
    [shown, onChanged]
  );
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "home2-queue", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs("button", { type: "button", className: "home2-queue-bar", onClick: () => setOpen((o) => !o), "aria-expanded": open, children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "home2-queue-ring" }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "home2-queue-count", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("strong", { children: shown.length }),
        " waiting for a slot"
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "home2-queue-spacer" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "home2-queue-note", children: "Drag to reorder — the top one takes the next free slot" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: `home2-queue-chev${open ? " open" : ""}`, children: /* @__PURE__ */ jsxRuntimeExports.jsx(Icon, { name: "chevron-right" }) })
    ] }),
    open ? /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "home2-queue-rows cord-scroll", children: shown.map((r, i) => /* @__PURE__ */ jsxRuntimeExports.jsxs(
      "div",
      {
        className: `home2-qrow${dragging === r.runId ? " dragging" : ""}${over === r.runId ? " target" : ""}`,
        draggable: true,
        onDragStart: (e) => {
          e.dataTransfer.effectAllowed = "move";
          setDragging(r.runId);
        },
        onDragOver: (e) => {
          e.preventDefault();
          setOver(r.runId);
        },
        onDrop: (e) => {
          e.preventDefault();
          if (dragging) void commit(moveBefore(order, dragging, r.runId));
          setDragging(null);
          setOver(null);
        },
        onDragEnd: () => {
          setDragging(null);
          setOver(null);
        },
        children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "home2-grip", children: /* @__PURE__ */ jsxRuntimeExports.jsx(Icon, { name: "grip-vertical" }) }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: `home2-pos mono${i === 0 ? " first" : ""}`, children: i + 1 }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "home2-qmark", "data-anon": "mark", children: displayName(r) }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "home2-qowner", "data-anon": "mark", children: ctx.ownerName(r.account) }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "home2-qdepth", children: runProductLabel(r.productName, r.marks.length) }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(CancelButton, { run: r, onChanged })
        ]
      },
      r.runId
    )) }) : null
  ] });
}
function CancelButton({ run, onChanged }) {
  const [busy, setBusy] = reactExports.useState(false);
  const [note, setNote] = reactExports.useState(null);
  return /* @__PURE__ */ jsxRuntimeExports.jsx(
    "button",
    {
      type: "button",
      className: "home2-cancel",
      disabled: busy,
      title: note ?? void 0,
      onClick: async () => {
        setBusy(true);
        const r = await api.cancelQueued(run.runId, run.account);
        setBusy(false);
        if (r.kind === "gate") setNote("It started just before this reached us — it is running now.");
        onChanged();
      },
      children: busy ? "…" : "Cancel"
    }
  );
}
function LastFinished({
  row,
  ctx
}) {
  return /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "home2-done-band", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "home2-band-label faint", children: "Last finished" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "home2-band-rule" })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "home2-done", onClick: () => ctx.go(`/portal/result/${encodeURIComponent(row.runId)}`), children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "home2-done-dot", style: row.tone ? { background: toneColor(row.tone) } : void 0 }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "home2-done-mark", "data-anon": "mark", children: row.name }),
      row.band ? /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "home2-done-verdict", children: row.band }) : null,
      /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "home2-done-meta", "data-anon": "mark", children: [
        "· ",
        ctx.ownerName(row.account),
        row.date ? ` · ${row.date}` : ""
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "home2-done-spacer" }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs(
        "button",
        {
          type: "button",
          className: "home2-all",
          onClick: (e) => {
            e.stopPropagation();
            ctx.go("/portal/clearances");
          },
          children: [
            "All clearances",
            /* @__PURE__ */ jsxRuntimeExports.jsx(Icon, { name: "arrow-right" })
          ]
        }
      )
    ] })
  ] });
}
function FirstRun$1({ onNew }) {
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "home2-firstrun", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx("p", { children: "Clear a name against the registers and the live marketplace. What is running shows here, and you can stop it from here." }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("button", { type: "button", className: "home2-new", onClick: onNew, children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx(Icon, { name: "plus-circle" }),
      "New clearance"
    ] })
  ] });
}
function pageWindow(rows, page, size) {
  const pageCount = Math.max(1, Math.ceil(rows.length / size));
  const current = Math.min(Math.max(0, Math.floor(page) || 0), pageCount - 1);
  const start = current * size;
  const visible2 = rows.slice(start, start + size);
  return {
    current,
    pageCount,
    visible: visible2,
    // 1-based and inclusive, because these are read by a human: "1–50 of 73".
    from: rows.length ? start + 1 : 0,
    to: Math.min(rows.length, start + size),
    total: rows.length
  };
}
function RiskDot({ tone, label }) {
  if (!label) return /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { color: "var(--text-faint)" }, children: "—" });
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { style: { display: "inline-flex", alignItems: "center", gap: 8, whiteSpace: "nowrap" }, children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx(
      "span",
      {
        className: "dot",
        style: tone ? { background: toneColor(tone) } : { border: "2px solid var(--text-faint)" }
      }
    ),
    /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { fontWeight: 600 }, children: label })
  ] });
}
function resumeWording(iso) {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return "on its own";
  const time = t.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
  const sameDay = t.toDateString() === (/* @__PURE__ */ new Date()).toDateString();
  return sameDay ? `at ${time}` : `${t.toLocaleDateString([], { weekday: "long" })} at ${time}`;
}
function StatusCell({
  state,
  step,
  stepN,
  stepTotal,
  reason,
  failedStage,
  pausedKind = null,
  resetsAt = null,
  stopRequestedAt = null,
  detailed = false
}) {
  if (stopRequestedAt && state !== "delivered" && state !== "failed" && state !== "cancelled") {
    return /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "status", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "dot", style: { background: "var(--text-faint)" } }),
        "Stopping…"
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "sub", children: [
        step ? `Letting “${step}” finish — a reasoning step can take tens of minutes.` : "Letting the step in flight finish — a reasoning step can take tens of minutes.",
        " ",
        "Nothing further will start."
      ] })
    ] });
  }
  if (state === "delivered") {
    return /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "status", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "dot", style: { background: "var(--accent)" } }),
      "Finished"
    ] });
  }
  if (state === "cancelled") {
    return /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "status", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "dot", style: { background: "var(--text-faint)" } }),
        "Stopped"
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "sub", children: "Stopped before it finished. Nothing was delivered." })
    ] });
  }
  if (state === "failed") {
    const f = readableFailure(failedStage, reason);
    return /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "status failed", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "dot", style: { background: "var(--tone-high)" } }),
        f.headline
      ] }),
      f.detail ? /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "sub", children: f.detail }) : null,
      detailed && f.raw ? /* @__PURE__ */ jsxRuntimeExports.jsxs("details", { className: "sub", style: { marginTop: 2 }, children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("summary", { style: { cursor: "pointer" }, children: "Details" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "mono", style: { display: "block", marginTop: 4, whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 11.5 }, children: f.raw })
      ] }) : null
    ] });
  }
  const label = state === "queued" ? "Queued" : state === "paused" ? "Paused" : "Running";
  const detail = state === "paused" ? pausedKind === "recovering" ? "Held after a problem — retrying on its own" : pausedKind === "operator" ? "Paused by a system restart — resumes on its own" : resetsAt ? `Paused by a provider limit — resumes ${resumeWording(resetsAt)}` : "Paused by a provider limit — resumes on its own" : step ? stepN != null && stepTotal != null ? `${step} · ${stepN} of ${stepTotal}` : step : null;
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "status", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: `dot ${state}` }),
      label
    ] }),
    detail ? /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "sub", children: detail }) : null
  ] });
}
const FIRST_CLICK_DESC = {
  date: true,
  // newest first
  risk: false,
  // worst first
  title: false,
  // A to Z
  state: false
};
const TERMINAL = /* @__PURE__ */ new Set(["delivered", "failed", "cancelled"]);
const PAGE = 50;
const GROUP_PREF_KEY = "cordillera-clearances-group-by-owner";
function readGroupPref() {
  try {
    return localStorage.getItem(GROUP_PREF_KEY) !== "off";
  } catch {
    return true;
  }
}
function writeGroupPref(on) {
  try {
    localStorage.setItem(GROUP_PREF_KEY, on ? "on" : "off");
  } catch {
  }
}
function Clearances({ ctx }) {
  const [filter, setFilter] = reactExports.useState("all");
  const [sort, setSort] = reactExports.useState({ key: "date", desc: true });
  const [query, setQuery] = reactExports.useState("");
  const [open, setOpen] = reactExports.useState(/* @__PURE__ */ new Set());
  const [page, setPage] = reactExports.useState(0);
  const { result, reload } = useLoad(() => api.runsMine(), []);
  const allRuns = (result == null ? void 0 : result.kind) === "ok" ? result.value : [];
  const ownerFilter = ctx.owner;
  const runs = reactExports.useMemo(
    () => ownerFilter ? allRuns.filter((r) => r.account === ownerFilter) : allRuns,
    [allRuns, ownerFilter]
  );
  const seeded = reactExports.useRef(false);
  reactExports.useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    const wanted = new URLSearchParams(window.location.search).get("owner");
    if (wanted && wanted !== ctx.owner) ctx.setOwner(wanted);
  }, [ctx]);
  const account = ownerFilter ?? (ctx.me.allAccounts ? "*" : ctx.me.accounts.length === 1 ? ctx.me.accounts[0] : null);
  const { result: famResult, reload: reloadFamilies } = useLoad(() => api.families(account), [account]);
  const families = (famResult == null ? void 0 : famResult.kind) === "ok" ? famResult.value : NO_FAMILIES;
  const [picked, setPicked] = reactExports.useState(/* @__PURE__ */ new Set());
  const canGroup = ctx.me.role === "staff";
  const [showRetired, setShowRetired] = reactExports.useState(false);
  const { result: retiredResult, reload: reloadRetired } = useLoad(
    () => canGroup ? api.retiredRuns(account) : Promise.resolve({ kind: "notFound" }),
    [account, canGroup]
  );
  const retired = (retiredResult == null ? void 0 : retiredResult.kind) === "ok" ? retiredResult.value : [];
  reactExports.useEffect(() => {
    setPicked(/* @__PURE__ */ new Set());
  }, [ownerFilter]);
  usePoll(reload, {
    active: runs.some((r) => !TERMINAL.has(r.state)),
    rateLimited: (result == null ? void 0 : result.kind) === "rateLimited"
  });
  const ownersHeld = reactExports.useMemo(() => new Set(allRuns.map((r) => r.account)).size, [allRuns]);
  const [groupByOwner, setGroupByOwner] = reactExports.useState(readGroupPref);
  const groupable = ownerFilter === null && ownersHeld > 1;
  const grouped = groupable && groupByOwner;
  const showOwnerColumn = groupable && !groupByOwner;
  const failedCount = reactExports.useMemo(
    () => marksOf(runs, families).filter((m) => m.current.state === "failed").length,
    [runs, families]
  );
  const rows = reactExports.useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = runs.filter((r) => {
      if (filter === "finished" && !TERMINAL.has(r.state)) return false;
      if (filter === "progress" && TERMINAL.has(r.state)) return false;
      if (q && !displayName(r).toLowerCase().includes(q) && !r.marks.some((m) => m.name.toLowerCase().includes(q))) return false;
      return true;
    });
    const marks = marksOf(filtered, families).filter((m) => filter === "failed" === (m.current.state === "failed"));
    const dir = sort.desc ? -1 : 1;
    return [...rowsOf(marks, families)].sort((a, b) => {
      if (grouped && a.account !== b.account) return a.account.localeCompare(b.account);
      switch (sort.key) {
        case "title":
          return dir * a.name.localeCompare(b.name);
        case "state":
          return dir * a.state.localeCompare(b.state);
        case "risk":
          return dir * (bandRank(a.bands, a.band) - bandRank(b.bands, b.band));
        case "date":
        default:
          return -dir * newestFirst(a, b);
      }
    });
  }, [runs, filter, query, sort, grouped, families]);
  const { current, pageCount, visible: visible2, from, to } = pageWindow(rows, page, PAGE);
  const resetPage = () => setPage(0);
  if (result && result.kind === "pickAccount") {
    return /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "screen", children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "notice", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("b", { children: "Choose a brand owner" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("p", { style: { margin: "6px 0 0", color: "var(--text-muted)" }, children: "This sign-in covers several brand owners. Pick one in the sidebar to see its clearances." })
    ] }) });
  }
  if (result && result.kind !== "ok") {
    return /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "screen", children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "notice", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("b", { children: result.kind === "rateLimited" ? "Too many requests just now" : "The list could not be loaded" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("p", { style: { margin: "6px 0 0", color: "var(--text-muted)" }, children: result.kind === "rateLimited" ? "The portal is pacing requests. This page will retry on its own in a minute." : "Nothing has been lost — any run in progress is still running. Try again shortly." })
    ] }) });
  }
  if (!result) return /* @__PURE__ */ jsxRuntimeExports.jsx(Loading, {});
  if (!runs.length) return /* @__PURE__ */ jsxRuntimeExports.jsx(FirstRun, { go: ctx.go });
  const allMarks = rows.flatMap((r) => r.kind === "family" ? r.marks : [r]);
  const pickedRunIds = () => allMarks.filter((m) => picked.has(m.id)).flatMap((m) => m.reads.map((r) => r.runId));
  const ungroupFamily = async (family) => {
    const runIds = family.marks.flatMap((m) => m.reads.map((r2) => r2.runId));
    if (!runIds.length) return;
    const n = family.marks.length;
    if (!window.confirm(`Ungroup "${inSentence(family.name)}"? The ${n} ${n === 1 ? "name" : "names"} stay exactly as they are — only the family goes.`)) return;
    const r = await api.setFamily({ action: "ungroup", runIds });
    if (r.kind !== "ok") {
      window.alert(saveFailureText(r));
      return;
    }
    setPicked(/* @__PURE__ */ new Set());
    reloadFamilies();
  };
  const retireMark = async (mark) => {
    const runIds = mark.reads.map((r2) => r2.runId);
    if (!runIds.length) return;
    const n = runIds.length;
    const what = n === 1 ? "The read stays" : `All ${n} reads stay`;
    if (!window.confirm(`Retire ${inSentence(mark.name)}? ${what} in the pool and the report links keep working — it comes off this list, and "Show retired" brings it back.`)) return;
    const r = await api.setRetired({ action: "retire", runIds });
    if (r.kind !== "ok") {
      window.alert(saveFailureText(r));
      return;
    }
    reload();
    reloadRetired();
  };
  const retireRun = async (run) => {
    if (!window.confirm(`Retire this read — ${inSentence(readLabel(run), 80)}? Only this one read comes off the list. Its report link keeps working, the other reads of this name stay where they are, and "Show retired" brings it back.`)) return;
    const r = await api.setRetired({ action: "retire", runIds: [run.runId] });
    if (r.kind !== "ok") {
      window.alert(saveFailureText(r));
      return;
    }
    reload();
    reloadRetired();
  };
  const restoreRun = async (run) => {
    const r = await api.setRetired({ action: "restore", runIds: [run.runId] });
    if (r.kind !== "ok") {
      window.alert(saveFailureText(r));
      return;
    }
    reload();
    reloadRetired();
  };
  const pick = (id) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const toggle = (id) => setOpen((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const sortBtn = (key, label) => /* @__PURE__ */ jsxRuntimeExports.jsxs(
    "button",
    {
      type: "button",
      onClick: () => {
        setSort((s) => ({ key, desc: s.key === key ? !s.desc : FIRST_CLICK_DESC[key] }));
        resetPage();
      },
      children: [
        label,
        sort.key === key ? /* @__PURE__ */ jsxRuntimeExports.jsx("span", { "aria-hidden": "true", children: sort.desc ? "↓" : "↑" }) : null,
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }, children: sort.key === key ? sort.desc ? ", sorted descending" : ", sorted ascending" : ", not sorted" })
      ]
    }
  );
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "screen", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "eyebrow", children: "Clearances" }),
    /* @__PURE__ */ jsxRuntimeExports.jsx("h1", { style: { fontSize: 27, margin: "4px 0 6px", color: "var(--text-strong)" }, children: ownerFilter ? ctx.ownerName(ownerFilter) : "Clearances" }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { style: { margin: 0, color: "var(--text-muted)" }, children: [
      "Every name in clearance and where it stands. Open a row to see each read on that name.",
      /* @__PURE__ */ jsxRuntimeExports.jsx(AllowanceLine, { account })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "controls", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "segmented", role: "group", "aria-label": "Filter by status", children: [
        ["all", "All"],
        ["progress", "In progress"],
        ["finished", "Finished"],
        // criterion 5 — the failed names' one route in. Labelled with its count for the same
        // reason "Show retired (N)" is, and rendered even at zero: a tab that appears only when
        // something breaks is one nobody knows to look for on the day something does.
        ["failed", failedCount ? `Failed (${failedCount})` : "Failed"]
      ].map(([k, label]) => /* @__PURE__ */ jsxRuntimeExports.jsx(
        "button",
        {
          type: "button",
          "aria-pressed": filter === k,
          onClick: () => {
            setFilter(k);
            resetPage();
          },
          children: label
        },
        k
      )) }),
      groupable ? /* @__PURE__ */ jsxRuntimeExports.jsxs("label", { className: "group-toggle", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(
          "input",
          {
            type: "checkbox",
            className: "pickbox",
            checked: groupByOwner,
            onChange: (e) => {
              setGroupByOwner(e.target.checked);
              writeGroupPref(e.target.checked);
              resetPage();
            }
          }
        ),
        "Group by brand owner"
      ] }) : null,
      /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "mono", style: { marginLeft: "auto", color: "var(--text-muted)", fontSize: 13 }, children: [
        rows.length,
        " ",
        rows.length === 1 ? "name" : "names"
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsx(
        "input",
        {
          className: "filter",
          type: "search",
          placeholder: "Filter by name",
          "aria-label": "Filter by name",
          value: query,
          onChange: (e) => {
            setQuery(e.target.value);
            resetPage();
          }
        }
      )
    ] }),
    canGroup && picked.size > 0 ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "selection-bar", role: "region", "aria-label": "Selected names", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("b", { children: [
        picked.size,
        " ",
        picked.size === 1 ? "name" : "names",
        " selected"
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { flex: 1 } }),
      /* @__PURE__ */ jsxRuntimeExports.jsx(
        "button",
        {
          type: "button",
          className: "nav-item",
          style: { width: "auto", margin: 0, padding: "6px 11px", border: "1px solid var(--border-hairline)" },
          onClick: async () => {
            const name = window.prompt("Group these names under which family?");
            if (!(name == null ? void 0 : name.trim())) return;
            const runIds = pickedRunIds();
            const r = await api.setFamily({ action: "group", name: name.trim(), runIds });
            if (r.kind !== "ok") {
              window.alert(saveFailureText(r, "That grouping could not be saved."));
              return;
            }
            setPicked(/* @__PURE__ */ new Set());
            reloadFamilies();
          },
          children: "Group as a family"
        }
      ),
      [...picked].some((id) => {
        var _a;
        return (_a = rows.flatMap((r) => r.kind === "family" ? r.marks : [r]).find((m) => m.id === id)) == null ? void 0 : _a.familyId;
      }) ? /* @__PURE__ */ jsxRuntimeExports.jsx(
        "button",
        {
          type: "button",
          className: "nav-item",
          style: { width: "auto", margin: 0, padding: "6px 11px", border: "1px solid var(--border-hairline)" },
          onClick: async () => {
            const r = await api.setFamily({ action: "ungroup", runIds: pickedRunIds() });
            if (r.kind !== "ok") {
              window.alert(saveFailureText(r));
              return;
            }
            setPicked(/* @__PURE__ */ new Set());
            reloadFamilies();
          },
          children: "Remove from family"
        }
      ) : null,
      /* @__PURE__ */ jsxRuntimeExports.jsx(
        "button",
        {
          type: "button",
          className: "nav-item",
          style: { width: "auto", margin: 0, padding: "6px 11px" },
          onClick: () => setPicked(/* @__PURE__ */ new Set()),
          children: "Clear"
        }
      )
    ] }) : null,
    /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "table-wrap", children: /* @__PURE__ */ jsxRuntimeExports.jsxs("table", { className: "data fixed", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("colgroup", { children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("col", { style: { width: "5%" } }),
        canGroup ? /* @__PURE__ */ jsxRuntimeExports.jsx("col", { style: { width: "5%" } }) : null,
        /* @__PURE__ */ jsxRuntimeExports.jsx("col", { style: { width: showOwnerColumn ? "26%" : "35%" } }),
        showOwnerColumn ? /* @__PURE__ */ jsxRuntimeExports.jsx("col", { style: { width: "16%" } }) : null,
        /* @__PURE__ */ jsxRuntimeExports.jsx("col", { style: { width: showOwnerColumn ? "18%" : "25%" } }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("col", { style: { width: "15%" } }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("col", { style: { width: "15%" } })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("thead", { children: /* @__PURE__ */ jsxRuntimeExports.jsxs("tr", { children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("th", {}),
        canGroup ? /* @__PURE__ */ jsxRuntimeExports.jsx("th", { "aria-label": "Select for grouping" }) : null,
        /* @__PURE__ */ jsxRuntimeExports.jsx("th", { children: sortBtn("title", "Name") }),
        showOwnerColumn ? /* @__PURE__ */ jsxRuntimeExports.jsx("th", { children: "Brand owner" }) : null,
        /* @__PURE__ */ jsxRuntimeExports.jsx("th", { children: sortBtn("state", "Status") }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("th", { children: sortBtn("risk", "Risk") }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("th", { children: sortBtn("date", "Updated") })
      ] }) }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("tbody", { children: visible2.map((r, i) => {
        var _a;
        const newGroup = grouped && r.account !== ((_a = visible2[i - 1]) == null ? void 0 : _a.account);
        return /* @__PURE__ */ jsxRuntimeExports.jsxs(reactExports.Fragment, { children: [
          newGroup ? (
            // — A SECTION HEADER, not a decorative divider. This was the smallest,
            // lowest-contrast, most letterspaced type on the page, which read as a rule between
            // rows rather than as "everything below this belongs to Aurora Interactive".
            /* @__PURE__ */ jsxRuntimeExports.jsx("tr", { className: "group-head", children: /* @__PURE__ */ jsxRuntimeExports.jsxs("td", { colSpan: (canGroup ? 6 : 5) + (showOwnerColumn ? 1 : 0), children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "owner-name", "data-anon": "mark", children: ctx.ownerName(r.account) }),
              /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "owner-count", children: [
                rows.filter((x) => x.account === r.account).length,
                " in this view"
              ] })
            ] }) })
          ) : null,
          r.kind === "family" ? /* @__PURE__ */ jsxRuntimeExports.jsx(
            FamilyRows,
            {
              family: r,
              isOpen: (id) => open.has(id),
              onToggle: toggle,
              go: ctx.go,
              picking: canGroup,
              showOwner: showOwnerColumn,
              ownerLabel: ctx.ownerName(r.account),
              isPicked: (id) => picked.has(id),
              onPick: pick,
              onUngroup: canGroup ? ungroupFamily : void 0,
              onRetire: canGroup ? retireMark : void 0,
              onRetireRun: canGroup ? retireRun : void 0
            }
          ) : /* @__PURE__ */ jsxRuntimeExports.jsx(
            MarkRow,
            {
              mark: r,
              open: open.has(r.id),
              onToggle: () => toggle(r.id),
              go: ctx.go,
              picking: canGroup,
              showOwner: showOwnerColumn,
              ownerLabel: ctx.ownerName(r.account),
              picked: picked.has(r.id),
              onPick: () => pick(r.id),
              onRetire: canGroup ? retireMark : void 0,
              onRetireRun: canGroup ? retireRun : void 0
            }
          )
        ] }, r.id);
      }) })
    ] }) }),
    !rows.length ? /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "empty", children: "No names match this view." }) : null,
    canGroup && retired.length ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { marginTop: 18 }, children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx(
        "button",
        {
          type: "button",
          className: "linkish",
          style: { font: "inherit", fontSize: 13, background: "none", border: "none", padding: 0, color: "var(--text-muted)", cursor: "pointer", textDecoration: "underline" },
          "aria-expanded": showRetired,
          onClick: () => setShowRetired((v) => !v),
          children: showRetired ? "Hide retired" : `Show retired (${retired.length})`
        }
      ),
      showRetired ? /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "table-wrap", style: { marginTop: 10 }, children: /* @__PURE__ */ jsxRuntimeExports.jsxs("table", { className: "data", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("thead", { children: /* @__PURE__ */ jsxRuntimeExports.jsxs("tr", { children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("th", { children: "Name" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("th", { children: "Brand owner" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("th", { children: "Updated" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("th", { "aria-label": "Restore" })
        ] }) }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("tbody", { children: retired.map((run) => /* @__PURE__ */ jsxRuntimeExports.jsxs("tr", { className: "row", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("td", { children: /* @__PURE__ */ jsxRuntimeExports.jsx("b", { "data-anon": "mark", style: { color: "var(--text-strong)" }, children: displayName(run) }) }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("td", { "data-anon": "mark", style: { color: "var(--text-muted)" }, children: ctx.ownerName(run.account) }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("td", { className: "mono", style: { color: "var(--text-muted)", fontSize: 13 }, children: run.date ?? "" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("td", { children: /* @__PURE__ */ jsxRuntimeExports.jsx(
            "button",
            {
              type: "button",
              className: "linkish",
              style: { font: "inherit", fontSize: 12, background: "none", border: "none", padding: 0, color: "var(--text-muted)", cursor: "pointer", textDecoration: "underline" },
              onClick: () => void restoreRun(run),
              children: "Restore"
            }
          ) })
        ] }, run.runId)) })
      ] }) }) : null
    ] }) : null,
    pageCount > 1 ? /* @__PURE__ */ jsxRuntimeExports.jsxs("nav", { className: "pager", "aria-label": "Pages of clearances", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "mono", style: { color: "var(--text-muted)", fontSize: 13 }, children: [
        from,
        "–",
        to,
        " of ",
        rows.length
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { flex: 1 } }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("button", { type: "button", disabled: current === 0, onClick: () => setPage(current - 1), children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(Icon, { name: "chevron-left", size: 14 }),
        "Previous"
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "mono", style: { color: "var(--text-muted)", fontSize: 13 }, children: [
        "Page ",
        current + 1,
        " of ",
        pageCount
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("button", { type: "button", disabled: current >= pageCount - 1, onClick: () => setPage(current + 1), children: [
        "Next",
        /* @__PURE__ */ jsxRuntimeExports.jsx(Icon, { name: "chevron", size: 14 })
      ] })
    ] }) : null
  ] });
}
function Loading() {
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "screen", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "eyebrow", children: "Clearances" }),
    /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "empty", role: "status", "aria-live": "polite", children: "Loading your clearances…" })
  ] });
}
function Twisty({ open, label, onToggle }) {
  return /* @__PURE__ */ jsxRuntimeExports.jsx(
    "button",
    {
      type: "button",
      className: "twisty",
      "aria-expanded": open,
      "aria-label": label,
      onClick: (e) => {
        e.stopPropagation();
        onToggle();
      },
      children: /* @__PURE__ */ jsxRuntimeExports.jsx(
        "span",
        {
          style: { display: "inline-block", transform: open ? "rotate(90deg)" : "none", transition: "transform .15s var(--ease-out)", color: "var(--text-faint)" },
          "aria-hidden": "true",
          children: /* @__PURE__ */ jsxRuntimeExports.jsx(Icon, { name: "chevron", size: 14 })
        }
      )
    }
  );
}
function FamilyRows({
  family,
  isOpen,
  onToggle,
  go,
  picking,
  showOwner = false,
  ownerLabel = "",
  isPicked,
  onPick,
  onUngroup,
  onRetire,
  onRetireRun
}) {
  const open = isOpen(family.id);
  return /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs("tr", { className: "row", onClick: () => onToggle(family.id), children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("td", { children: /* @__PURE__ */ jsxRuntimeExports.jsx(Twisty, { open, onToggle: () => onToggle(family.id), label: `${open ? "Collapse" : "Expand"} ${family.name}` }) }),
      picking ? /* @__PURE__ */ jsxRuntimeExports.jsx("td", {}) : null,
      /* @__PURE__ */ jsxRuntimeExports.jsxs("td", { children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("b", { "data-anon": "mark", style: { color: "var(--text-strong)" }, children: family.name }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "pill", style: { marginLeft: 8 }, children: [
          family.marks.length,
          " ",
          family.marks.length === 1 ? "name" : "names"
        ] }),
        family.band ? /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "sub", children: [
          "worst of ",
          family.marks.length,
          ": ",
          family.band
        ] }) : null,
        onUngroup ? /* @__PURE__ */ jsxRuntimeExports.jsx(
          "button",
          {
            type: "button",
            className: "linkish",
            style: { marginLeft: 10, font: "inherit", fontSize: 12, background: "none", border: "none", padding: 0, color: "var(--text-muted)", cursor: "pointer", textDecoration: "underline" },
            title: `Ungroup ${family.name} — the ${family.marks.length} ${family.marks.length === 1 ? "name" : "names"} stay, the family goes`,
            onClick: (e) => {
              e.stopPropagation();
              onUngroup(family);
            },
            children: "Ungroup"
          }
        ) : null
      ] }),
      showOwner ? /* @__PURE__ */ jsxRuntimeExports.jsx("td", { "data-anon": "mark", style: { color: "var(--text-muted)" }, children: ownerLabel }) : null,
      /* @__PURE__ */ jsxRuntimeExports.jsx("td", { children: /* @__PURE__ */ jsxRuntimeExports.jsx(StatusCell, { state: family.state, step: null, stepN: null, stepTotal: null, reason: null, failedStage: null }) }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("td", { children: family.band ? /* @__PURE__ */ jsxRuntimeExports.jsx(RiskDot, { tone: family.tone, label: family.band }) : /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { color: "var(--text-faint)" }, children: "—" }) }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("td", { className: "mono", style: { color: "var(--text-muted)", fontSize: 13 }, children: family.date ?? "" })
    ] }),
    open ? family.marks.map((m) => /* @__PURE__ */ jsxRuntimeExports.jsx(
      MarkRow,
      {
        mark: m,
        open: isOpen(m.id),
        onToggle: () => onToggle(m.id),
        go,
        indent: true,
        picking,
        showOwner,
        ownerLabel,
        picked: isPicked(m.id),
        onPick: () => onPick(m.id),
        onRetire,
        onRetireRun
      },
      m.id
    )) : null
  ] });
}
function MarkRow({
  mark,
  open,
  onToggle,
  go,
  indent = false,
  picking = false,
  showOwner = false,
  ownerLabel = "",
  picked = false,
  onPick,
  onRetire,
  onRetireRun
}) {
  const run = mark.current;
  const threaded = mark.reads.length > 1;
  return /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs("tr", { className: "row", onClick: onToggle, children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("td", { style: indent ? { paddingLeft: 26 } : void 0, children: /* @__PURE__ */ jsxRuntimeExports.jsx(Twisty, { open, onToggle, label: `${open ? "Collapse" : "Expand"} ${mark.name}` }) }),
      picking ? (
        // stopPropagation, or ticking a box would also expand the row underneath the cursor.
        /* @__PURE__ */ jsxRuntimeExports.jsx("td", { onClick: (e) => e.stopPropagation(), children: /* @__PURE__ */ jsxRuntimeExports.jsx(
          "input",
          {
            type: "checkbox",
            className: "pickbox",
            checked: Boolean(picked),
            onChange: () => onPick == null ? void 0 : onPick(),
            "aria-label": `Select ${mark.name} for grouping`
          }
        ) })
      ) : null,
      /* @__PURE__ */ jsxRuntimeExports.jsxs("td", { children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("b", { "data-anon": "mark", style: { color: "var(--text-strong)" }, children: mark.name }),
        threaded ? /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "pill", style: { marginLeft: 8 }, children: [
          mark.reads.length,
          " reads"
        ] }) : null,
        mark.improvedFrom ? /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "pill", style: { marginLeft: 8 }, title: `An earlier read of this name came back ${mark.improvedFrom}. The row shows where it stands now.`, children: [
          "was ",
          mark.improvedFrom
        ] }) : null,
        onRetire ? /* @__PURE__ */ jsxRuntimeExports.jsx(
          "button",
          {
            type: "button",
            className: "linkish",
            style: { marginLeft: 10, font: "inherit", fontSize: 12, background: "none", border: "none", padding: 0, color: "var(--text-muted)", cursor: "pointer", textDecoration: "underline" },
            title: threaded ? `Retire all ${mark.reads.length} reads of ${mark.name} — the whole name comes off this list for everyone; the reports and their links stay, and "Show retired" brings it back. To retire ONE read, open the row and use the Retire on that read.` : `Retire ${mark.name} — it comes off this list for everyone; the reports and their links stay, and "Show retired" brings it back`,
            onClick: (e) => {
              e.stopPropagation();
              onRetire(mark);
            },
            children: threaded ? `Retire all ${mark.reads.length}` : "Retire"
          }
        ) : null
      ] }),
      showOwner ? /* @__PURE__ */ jsxRuntimeExports.jsx("td", { "data-anon": "mark", style: { color: "var(--text-muted)" }, children: ownerLabel }) : null,
      /* @__PURE__ */ jsxRuntimeExports.jsx("td", { children: /* @__PURE__ */ jsxRuntimeExports.jsx(
        StatusCell,
        {
          state: run.state,
          step: run.step,
          stepN: run.stepN,
          stepTotal: run.stepTotal,
          reason: run.reason,
          failedStage: run.failedStage,
          pausedKind: run.pausedKind,
          resetsAt: run.resetsAt,
          stopRequestedAt: run.stopRequestedAt
        }
      ) }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("td", { children: run.state === "delivered" && mark.rowBands.length ? /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { display: "inline-flex", gap: 8, flexWrap: "wrap" }, children: mark.rowBands.map((label) => {
        var _a;
        return /* @__PURE__ */ jsxRuntimeExports.jsx(RiskDot, { tone: ((_a = run.bands.find((b) => b.label === label)) == null ? void 0 : _a.tone) ?? null, label }, label);
      }) }) : /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { color: "var(--text-faint)" }, children: "—" }) }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("td", { className: "mono", style: { color: "var(--text-muted)", fontSize: 13 }, children: mark.date ?? "" })
    ] }),
    open ? mark.reads.map((r) => /* @__PURE__ */ jsxRuntimeExports.jsx(
      ReadRow,
      {
        read: r,
        go,
        picking,
        indent,
        showOwner,
        current: r.runId === mark.current.runId,
        sameDayAsAnother: mark.reads.some((o) => o.runId !== r.runId && o.date === r.date),
        ...threaded ? { onRetire: onRetireRun } : {}
      },
      r.runId
    )) : null,
    open && run.marks.length > 1 ? /* @__PURE__ */ jsxRuntimeExports.jsx("tr", { children: /* @__PURE__ */ jsxRuntimeExports.jsx("td", { colSpan: (picking ? 6 : 5) + (showOwner ? 1 : 0), style: { background: "var(--surface-sunken)" }, children: /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { display: "grid", gap: 8, paddingLeft: indent ? 26 : 0 }, children: run.marks.map((m) => /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { display: "flex", alignItems: "center", gap: 12 }, children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("b", { "data-anon": "mark", style: { minWidth: 160 }, children: m.name }),
      /* @__PURE__ */ jsxRuntimeExports.jsx(RiskDot, { tone: m.tone, label: m.band })
    ] }, m.name)) }) }) }) : null
  ] });
}
function ReadRow({
  read,
  go,
  picking,
  indent,
  showOwner = false,
  current = false,
  sameDayAsAnother = false,
  onRetire
}) {
  const openable = Boolean(read.report) || read.reports.length > 0;
  const open = () => go(`/portal/result/${encodeURIComponent(read.runId)}`);
  return /* @__PURE__ */ jsxRuntimeExports.jsxs(
    "tr",
    {
      className: openable ? "read-row openable" : "read-row",
      ...openable ? {
        // A row is not a button, so it has to be told how to behave like one: reachable by Tab,
        // activated by Enter or Space, and named for what it opens rather than "row".
        role: "link",
        tabIndex: 0,
        "aria-label": `Open the report for ${readLabel(read)}`,
        onClick: open,
        onKeyDown: (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            open();
          }
        }
      } : {},
      children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("td", { style: { paddingLeft: indent ? 38 : 26 } }),
        picking ? /* @__PURE__ */ jsxRuntimeExports.jsx("td", {}) : null,
        /* @__PURE__ */ jsxRuntimeExports.jsxs("td", { children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "mono", style: { fontSize: 12.5, color: "var(--text-muted)" }, children: [
            readLabel(read),
            sameDayAsAnother && readTime(read) ? /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { style: { marginLeft: 6 }, children: [
              readTime(read),
              " UTC"
            ] }) : null
          ] }),
          current ? /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "pill", style: { marginLeft: 8 }, children: "current" }) : null,
          onRetire ? /* @__PURE__ */ jsxRuntimeExports.jsx(
            "button",
            {
              type: "button",
              className: "linkish",
              style: { marginLeft: 10, font: "inherit", fontSize: 12, background: "none", border: "none", padding: 0, color: "var(--text-muted)", cursor: "pointer", textDecoration: "underline" },
              title: `Retire this read — ${readLabel(read)}. Only this read comes off the list; the other reads of this name stay, the report link keeps working, and "Show retired" brings it back`,
              onClick: (e) => {
                e.stopPropagation();
                onRetire(read);
              },
              onKeyDown: (e) => e.stopPropagation(),
              children: "Retire"
            }
          ) : null
        ] }),
        showOwner ? /* @__PURE__ */ jsxRuntimeExports.jsx("td", {}) : null,
        /* @__PURE__ */ jsxRuntimeExports.jsx("td", { children: /* @__PURE__ */ jsxRuntimeExports.jsx(
          StatusCell,
          {
            state: read.state,
            step: read.step,
            stepN: read.stepN,
            stepTotal: read.stepTotal,
            reason: read.reason,
            failedStage: read.failedStage,
            stopRequestedAt: read.stopRequestedAt,
            detailed: true
          }
        ) }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("td", { children: read.state === "delivered" && read.band ? /* @__PURE__ */ jsxRuntimeExports.jsx(RiskDot, { tone: read.tone, label: read.band }) : /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { color: "var(--text-faint)" }, children: "—" }) }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("td", { className: "mono", style: { color: "var(--text-muted)", fontSize: 13 }, children: openable ? (
          // Not a button any more: the row IS the control, and a button inside a clickable row is two
          // targets for one action. What is left is a cue that the row leads somewhere — the affordance
          // is on the thing you can click, which is the fix the issue asks for.
          /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "read-go", "aria-hidden": "true", children: [
            "Open",
            /* @__PURE__ */ jsxRuntimeExports.jsx(Icon, { name: "chevron", size: 14 })
          ] })
        ) : read.state === "delivered" ? (
          // — WHAT THIS SAYS IS NOW WHAT IS TRUE. It used to claim the run was still with a reviewer
          // ahead of release — a step nobody performs — on a run that had
          // in fact been delivered. It could not be right in either branch: if the report was there it
          // was a lie about a file the customer could have been reading, and if it was genuinely absent
          // it was a lie about the reason. The state is: delivered, and this view has no file to link.
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "sub", style: { margin: 0 }, children: "Delivered — no report file found for this run." })
        ) : null })
      ]
    }
  );
}
function FirstRun({ go }) {
  return /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "screen", children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "empty", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx("h1", { style: { fontSize: 25, color: "var(--text-strong)", margin: "0 0 8px" }, children: "No clearances yet" }),
    /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "prose", style: { margin: "0 auto 22px" }, children: "Start with a name and the classes it will trade in. You will see the plan, and what it covers, before anything runs." }),
    /* @__PURE__ */ jsxRuntimeExports.jsx(
      "button",
      {
        type: "button",
        className: "nav-item active",
        style: { width: "auto", margin: "0 auto", justifyContent: "center" },
        onClick: () => go("/portal/new"),
        children: "Start your first clearance"
      }
    )
  ] }) });
}
function AllowanceLine({ account }) {
  const { result } = useLoad(
    () => account === "*" ? Promise.resolve({ kind: "pickAccount" }) : api.usage(account),
    [account]
  );
  if ((result == null ? void 0 : result.kind) !== "ok") return null;
  const u = result.value;
  if (!u.capped || u.dailyRuns == null) return null;
  const left = Math.max(0, u.dailyRuns - u.today);
  return /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { display: "block", marginTop: 6, fontSize: 13 }, children: left === 0 ? "You have used all of today’s searches — the allowance resets at midnight UTC." : `${u.today} of ${u.dailyRuns} searches used today.` });
}
const INLINE = /\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`/g;
function inlineSpans(text) {
  const src = String(text ?? "");
  const out = [];
  let at = 0;
  INLINE.lastIndex = 0;
  for (let m = INLINE.exec(src); m !== null; m = INLINE.exec(src)) {
    if (m.index > at) out.push({ text: src.slice(at, m.index), style: null });
    const [, bold, italic, code] = m;
    if (bold !== void 0) out.push({ text: bold, style: "strong" });
    else if (italic !== void 0) out.push({ text: italic, style: "em" });
    else out.push({ text: code, style: "code" });
    at = m.index + m[0].length;
  }
  if (at < src.length) out.push({ text: src.slice(at), style: null });
  return out;
}
const SUMMARY_BLOCK_LINE = /^[ \t]*(?:#{1,6}[ \t]|[-*][ \t])/m;
function parseSummaryBlocks(chunk) {
  const out = [];
  let para = [];
  let bullets = [];
  const flushPara = () => {
    if (para.length) {
      out.push({ kind: "para", text: para.join("\n") });
      para = [];
    }
  };
  const flushBullets = () => {
    if (bullets.length) {
      out.push({ kind: "bullets", items: bullets });
      bullets = [];
    }
  };
  for (const line of String(chunk ?? "").split(/\r?\n/)) {
    const h = line.match(/^[ \t]*(#{1,6})[ \t]+(.*)$/);
    if (h) {
      flushPara();
      flushBullets();
      out.push({ kind: "heading", level: (h[1] ?? "").length, text: (h[2] ?? "").trim() });
      continue;
    }
    const b = line.match(/^[ \t]*[-*][ \t]+(.*)$/);
    if (b) {
      flushPara();
      bullets.push((b[1] ?? "").trim());
      continue;
    }
    if (!line.trim()) {
      flushPara();
      flushBullets();
      continue;
    }
    flushBullets();
    para.push(line);
  }
  flushPara();
  flushBullets();
  return out;
}
const FRAME_TAG = "cordillera-report";
const FIRST_PAINT = 1400;
const MIN_FRAME = 320;
const MAX_FRAME = 2e5;
function exportMenu(offered) {
  const has2 = (c) => offered.includes(c);
  const rows = [];
  if (has2("exportPDF")) {
    rows.push({
      kind: "command",
      command: "exportPDF",
      value: null,
      label: has2("pickAll") ? "Export PDF (ticked findings)" : "Export PDF"
    });
  }
  rows.push({ kind: "download" });
  if (has2("pickAll") || has2("openAll")) rows.push({ kind: "separator" });
  if (has2("pickAll")) {
    rows.push({ kind: "command", command: "pickAll", value: true, label: "Select all findings" });
    rows.push({ kind: "command", command: "pickAll", value: false, label: "Select none" });
  }
  if (has2("openAll")) {
    rows.push({ kind: "command", command: "openAll", value: true, label: "Expand all" });
    rows.push({ kind: "command", command: "openAll", value: false, label: "Collapse all" });
  }
  if (has2("pickAll")) {
    rows.push({ kind: "note", text: "Tick a finding in the report to keep it in the exported PDF; untick to drop it." });
  }
  return rows;
}
function exportAffordance(controls) {
  return exportMenu(controls ?? []).some((r) => r.kind === "command") ? "menu" : "download";
}
function readFrameControls(data, sameSource) {
  if (!sameSource) return null;
  if (typeof data !== "object" || data === null) return null;
  const msg = data;
  if (msg.source !== FRAME_TAG || msg.type !== "controls") return null;
  const commands = Array.isArray(msg.commands) ? msg.commands : [];
  if (!Array.isArray(msg.commands)) return null;
  const known = ["exportPDF", "pickAll", "openAll"];
  return known.filter((v) => commands.includes(v));
}
function readFrameHeight(data, sameSource) {
  if (!sameSource) return null;
  if (typeof data !== "object" || data === null) return null;
  const msg = data;
  if (msg.source !== FRAME_TAG || msg.type !== "height") return null;
  if (typeof msg.height !== "number" || !Number.isFinite(msg.height)) return null;
  return Math.min(Math.max(msg.height, MIN_FRAME), MAX_FRAME);
}
function readFrameScroll(data, sameSource) {
  if (!sameSource) return null;
  if (typeof data !== "object" || data === null) return null;
  const msg = data;
  if (msg.source !== FRAME_TAG || msg.type !== "scrollTo") return null;
  if (typeof msg.top !== "number" || !Number.isFinite(msg.top)) return null;
  return Math.min(Math.max(msg.top, 0), MAX_FRAME);
}
function readCommandFailure(data, sameSource) {
  if (!sameSource) return null;
  if (typeof data !== "object" || data === null) return null;
  const m = data;
  if (m.source !== FRAME_TAG || m.type !== "commandFailed") return null;
  if (typeof m.command !== "string") return null;
  return { command: m.command, message: typeof m.message === "string" ? m.message : "it did not say why" };
}
function frameCommand(command, value) {
  return { source: FRAME_TAG, type: "command", command, value };
}
function askAiPrompt(runId, mark) {
  const name = String(mark ?? "this mark").trim() || "this mark";
  return runId ? `Brief me on trademark clearance run ${runId}.` : `Brief me on the ${name} trademark clearance.`;
}
function askAiOffer(runId, mark, access) {
  return {
    question: askAiPrompt(runId, mark),
    address: (access == null ? void 0 : access.enabled) ? access.url : null,
    instructionsPath: "/portal/ai",
    // Passed through, never composed here. A null address WITH a stdio route is a local install, and
    // that is the case where this control used to show a question and nowhere to ask it.
    stdio: (access == null ? void 0 : access.stdio) ?? null
  };
}
function useReportFrame() {
  const ref = reactExports.useRef(null);
  const [height, setHeight] = reactExports.useState(FIRST_PAINT);
  const [failed, setFailed] = reactExports.useState(null);
  const [controls, setControls] = reactExports.useState(null);
  reactExports.useEffect(() => {
    function onMessage(e) {
      const frame = ref.current;
      const mine = !!frame && e.source === frame.contentWindow;
      const h = readFrameHeight(e.data, mine);
      if (h !== null) {
        setHeight(h);
        return;
      }
      const has2 = readFrameControls(e.data, mine);
      if (has2 !== null) {
        setControls(has2);
        return;
      }
      const jump = readFrameScroll(e.data, mine);
      if (jump !== null) {
        if (frame) {
          const head = document.querySelector(".report-head");
          const chrome = 56 + (head instanceof HTMLElement ? head.offsetHeight : 48) + 10;
          const y = frame.getBoundingClientRect().top + window.scrollY + jump - chrome;
          window.scrollTo({ top: Math.max(0, y), behavior: "smooth" });
        }
        return;
      }
      const bad = readCommandFailure(e.data, mine);
      if (bad) {
        setFailed(`That did not work — the report could not ${bad.command}. (${bad.message})`);
        return;
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);
  const send = reactExports.useCallback((command, value) => {
    var _a, _b;
    setFailed(null);
    (_b = (_a = ref.current) == null ? void 0 : _a.contentWindow) == null ? void 0 : _b.postMessage(frameCommand(command, value), "*");
  }, []);
  return { ref, height, send, failed, controls, clearFailed: () => setFailed(null) };
}
function AskAiMenu({ runId, mark, ctx }) {
  const [open, setOpen] = reactExports.useState(false);
  const [copied, setCopied] = reactExports.useState(null);
  const box = reactExports.useRef(null);
  const { result } = useLoad(() => api.mcpAccess(), []);
  const access = (result == null ? void 0 : result.kind) === "ok" ? result.value : null;
  const offer = askAiOffer(runId, mark, access);
  reactExports.useEffect(() => {
    if (!open) return;
    function onDown(e) {
      var _a;
      if (!((_a = box.current) == null ? void 0 : _a.contains(e.target))) setOpen(false);
    }
    function onKey(e) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const copy2 = (what, value) => {
    void (async () => {
      var _a;
      try {
        await ((_a = navigator.clipboard) == null ? void 0 : _a.writeText(value));
        setCopied(what);
      } catch {
        setCopied(`${what}-failed`);
      }
    })();
  };
  const line = (label, value, key) => /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { padding: "7px 10px" }, children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { fontSize: 11, color: "var(--text-faint)", marginBottom: 3 }, children: label }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { display: "flex", alignItems: "center", gap: 8 }, children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "mono", style: { fontSize: 12, color: "var(--text-strong)", wordBreak: "break-all", flex: 1 }, children: value }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "link-btn", style: { fontSize: 12, flex: "none" }, onClick: () => copy2(key, value), children: copied === key ? "Copied" : copied === `${key}-failed` ? "Copy failed" : "Copy" })
    ] })
  ] });
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { ref: box, style: { position: "relative" }, children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs(
      "button",
      {
        type: "button",
        className: "nav-item",
        "aria-haspopup": "menu",
        "aria-expanded": open,
        style: { width: "auto", margin: 0, padding: "6px 11px", border: "1px solid var(--border-hairline)" },
        onClick: () => setOpen((v) => !v),
        children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(Icon, { name: "sparkles", size: 14 }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "Ask AI" })
        ]
      }
    ),
    open ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "float", role: "menu", style: { position: "absolute", right: 0, top: 38, width: 320, padding: 6, zIndex: 50 }, children: [
      line("Say this to your assistant", offer.question, "question"),
      offer.address ? line("Connector address", offer.address, "address") : (
        /* NOT SET UP HERE — AND THE BAND POINTS RATHER THAN TEACHES.
           The finalized design rules that the band "stops teaching setup inline and carries one
           line into this page": teaching connection inside a report is the fancy-readme problem in
           miniature. So a reader with no address gets the reason and one way forward, and the page
           is where the route that works for THEIR deployment is derived — including the local
           one-liner, which is 1959's half and belongs there, not repeated here. */
        /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { style: { margin: 0, padding: "7px 10px", fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }, children: [
          offer.stdio ? "This deployment has no published address, but your assistant can connect to it directly. " : "No connector is set up on this deployment yet, so there is no address to paste. ",
          "The question above is what to ask once it is connected."
        ] })
      ),
      /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { height: 1, background: "var(--border-hairline)", margin: "5px 8px" } }),
      /* @__PURE__ */ jsxRuntimeExports.jsx(
        "button",
        {
          type: "button",
          role: "menuitem",
          className: "nav-item",
          style: { fontSize: 13, padding: "7px 10px" },
          onClick: () => {
            setOpen(false);
            ctx.go(offer.instructionsPath);
          },
          children: "How to connect your assistant"
        }
      )
    ] }) : null
  ] });
}
function ExportMenu({
  send,
  runId,
  offered
}) {
  const [open, setOpen] = reactExports.useState(false);
  const box = reactExports.useRef(null);
  reactExports.useEffect(() => {
    if (!open) return;
    function onDown(e) {
      var _a;
      if (!((_a = box.current) == null ? void 0 : _a.contains(e.target))) setOpen(false);
    }
    function onKey(e) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const item = (label, onClick) => /* @__PURE__ */ jsxRuntimeExports.jsx(
    "button",
    {
      type: "button",
      role: "menuitem",
      className: "nav-item",
      style: { fontSize: 13, padding: "7px 10px" },
      onClick: () => {
        onClick();
        setOpen(false);
      },
      children: label
    },
    label
  );
  const rows = exportMenu(offered);
  const auditHref = `/portal/report/${encodeURIComponent(runId)}/audit.xlsx`;
  if (exportAffordance(offered) === "download") {
    return /* @__PURE__ */ jsxRuntimeExports.jsxs(
      "a",
      {
        className: "nav-item",
        style: { width: "auto", margin: 0, padding: "6px 11px", border: "1px solid var(--border-hairline)", textDecoration: "none" },
        href: auditHref,
        download: true,
        children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(Icon, { name: "layers", size: 14 }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "Download audit" })
        ]
      }
    );
  }
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { ref: box, style: { position: "relative" }, children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs(
      "button",
      {
        type: "button",
        className: "nav-item",
        "aria-haspopup": "menu",
        "aria-expanded": open,
        style: { width: "auto", margin: 0, padding: "6px 11px", border: "1px solid var(--border-hairline)" },
        onClick: () => setOpen((v) => !v),
        children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(Icon, { name: "layers", size: 14 }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "Export" })
        ]
      }
    ),
    open ? /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "float", role: "menu", style: { position: "absolute", right: 0, top: 38, width: 250, padding: 6, zIndex: 50 }, children: rows.map((row, i) => {
      if (row.kind === "command") {
        return item(row.label, () => row.value === null ? send(row.command) : send(row.command, row.value));
      }
      if (row.kind === "separator") {
        return /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { height: 1, background: "var(--border-hairline)", margin: "5px 8px" } }, `sep${i}`);
      }
      if (row.kind === "note") {
        return /* @__PURE__ */ jsxRuntimeExports.jsx("p", { style: { margin: "6px 10px 4px", fontSize: 11.5, color: "var(--text-muted)", lineHeight: 1.45 }, children: row.text }, `note${i}`);
      }
      return /* @__PURE__ */ jsxRuntimeExports.jsx(
        "a",
        {
          role: "menuitem",
          className: "nav-item",
          style: { fontSize: 13, padding: "7px 10px", textDecoration: "none" },
          href: auditHref,
          download: true,
          onClick: () => setOpen(false),
          children: "Download full audit (Excel)"
        },
        "dl"
      );
    }) }) : null
  ] });
}
function SummaryBlocks({ chunk, first }) {
  if (!SUMMARY_BLOCK_LINE.test(chunk)) {
    return /* @__PURE__ */ jsxRuntimeExports.jsx("p", { style: { margin: first ? "6px 0 0" : "10px 0 0", color: "var(--text-body)" }, children: /* @__PURE__ */ jsxRuntimeExports.jsx(Prose, { text: chunk }) });
  }
  return /* @__PURE__ */ jsxRuntimeExports.jsx(jsxRuntimeExports.Fragment, { children: parseSummaryBlocks(chunk).map(
    (b, i) => b.kind === "heading" ? (
      /* Depth is the report's, not the page's: the summary sits under the run's own heading, so a
         sub-header inside it renders as a strong label and never as another page title. */
      /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { margin: i === 0 && first ? "6px 0 4px" : "14px 0 4px", fontWeight: 800, fontSize: 13.5, color: "var(--text-body)" }, children: /* @__PURE__ */ jsxRuntimeExports.jsx(Prose, { text: b.text }) }, i)
    ) : b.kind === "bullets" ? /* @__PURE__ */ jsxRuntimeExports.jsx("ul", { style: { margin: "4px 0 0", paddingLeft: 18, color: "var(--text-body)" }, children: b.items.map((it, j) => /* @__PURE__ */ jsxRuntimeExports.jsx("li", { style: { margin: "0 0 4px" }, children: /* @__PURE__ */ jsxRuntimeExports.jsx(Prose, { text: it }) }, j)) }, i) : /* @__PURE__ */ jsxRuntimeExports.jsx("p", { style: { margin: i === 0 && first ? "6px 0 0" : "10px 0 0", color: "var(--text-body)" }, children: /* @__PURE__ */ jsxRuntimeExports.jsx(Prose, { text: b.text }) }, i)
  ) });
}
function Prose({ text }) {
  return /* @__PURE__ */ jsxRuntimeExports.jsx(jsxRuntimeExports.Fragment, { children: inlineSpans(text).map(
    (s, i) => s.style === "strong" ? /* @__PURE__ */ jsxRuntimeExports.jsx("b", { children: s.text }, i) : s.style === "em" ? /* @__PURE__ */ jsxRuntimeExports.jsx("i", { children: s.text }, i) : s.style === "code" ? /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "mono", children: s.text }, i) : /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: s.text }, i)
  ) });
}
function Result({
  ctx,
  runId,
  markSlug
}) {
  const { result } = useLoad(() => api.runsMine(), []);
  const runs = (result == null ? void 0 : result.kind) === "ok" ? result.value : [];
  const run = reactExports.useMemo(() => runs.find((r) => r.runId === runId) ?? null, [runs, runId]);
  const reads = reactExports.useMemo(() => run ? readsFor(runs, run) : [], [runs, run]);
  const frame = useReportFrame();
  const grouped = run !== null && showsAssessment(run, markSlug);
  const { result: summaryResult } = useLoad(
    () => grouped ? api.runSummary(runId) : Promise.resolve({ kind: "notFound" }),
    [runId, grouped]
  );
  const assessment = (summaryResult == null ? void 0 : summaryResult.kind) === "ok" ? summaryResult.value : [];
  if (result && result.kind !== "ok") {
    return /* @__PURE__ */ jsxRuntimeExports.jsx(Missing, { go: ctx.go, reason: result.kind === "notFound" ? "notFound" : "error" });
  }
  if (!result) return /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "screen report" });
  if (!run) return /* @__PURE__ */ jsxRuntimeExports.jsx(Missing, { go: ctx.go, reason: "notFound" });
  const product = runProductLabel(run.productName, run.marks.length);
  const { doc, mark: pickedMark, missing } = openDocument(run, markSlug);
  const heading = markSlug === null ? displayName(run) : pickedMark ?? markSlug;
  const family = resultPath(run.runId);
  const back = markSlug === null ? { label: "Clearances", href: "/portal/clearances" } : { label: "All names", href: family };
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "screen report", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }, children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs(
        "button",
        {
          type: "button",
          className: "nav-item",
          style: { width: "auto", padding: "4px 8px", margin: 0 },
          onClick: () => ctx.go(back.href),
          children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(Icon, { name: "chevron-left", size: 14 }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: back.label })
          ]
        }
      ),
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "crumb", children: "›" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "crumb", "data-anon": "mark", children: displayName(run) }),
      markSlug === null ? null : /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "crumb", children: "›" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "crumb", "data-anon": "mark", children: pickedMark ?? markSlug })
      ] })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "report-head", children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 2 }, children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("h1", { style: { fontSize: 19, fontWeight: 700, margin: 0, color: "var(--text-strong)" }, "data-anon": "mark", children: heading }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { color: "var(--text-muted)", fontSize: 13 }, children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { "data-anon": "mark", children: ctx.ownerName(run.account) }),
        product ? /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
          " · ",
          product
        ] }) : null,
        !product && run.kind === "knockout-batch" ? /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
          " · ",
          run.marks.length,
          " names"
        ] }) : null,
        run.date ? /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
          " · ",
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "mono", children: run.date })
        ] }) : null
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsx(RiskDot, { tone: run.tone, label: run.band }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { flex: 1 } }),
      /* @__PURE__ */ jsxRuntimeExports.jsx(AskAiMenu, { runId: run.runId, mark: run.markName, ctx }),
      doc ? /* @__PURE__ */ jsxRuntimeExports.jsx(ExportMenu, { send: frame.send, runId: run.runId, offered: frame.controls ?? [] }) : null
    ] }) }),
    hasThread(reads) ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { display: "flex", gap: 8, flexWrap: "wrap", margin: "18px 0 4px" }, children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "eyebrow", style: { alignSelf: "center" }, children: "Reads" }),
      reads.map((r) => {
        const active2 = r.runId === run.runId;
        return /* @__PURE__ */ jsxRuntimeExports.jsxs(
          "button",
          {
            type: "button",
            className: "pill",
            "aria-current": active2 ? "true" : void 0,
            onClick: () => ctx.go(resultPath(r.runId)),
            style: {
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              background: active2 ? "var(--accent-wash)" : "var(--surface-sunken)",
              borderColor: active2 ? "var(--accent)" : "var(--border-hairline)",
              color: active2 ? "var(--text-accent)" : "var(--text-muted)"
            },
            children: [
              r.tone ? /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "dot", style: { background: `var(--tone-${r.tone})`, width: 7, height: 7 } }) : null,
              readLabel(r)
            ]
          },
          r.runId
        );
      })
    ] }) : null,
    frame.failed ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "notice", style: { borderLeftColor: "var(--tone-high)" }, role: "alert", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("b", { children: frame.failed }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("p", { style: { margin: "6px 0 0", color: "var(--text-muted)" }, children: "The report itself is unaffected — you can still read and print it from the page." })
    ] }) : null,
    doc ? (
      /* The frame's accessible name is composed HERE, from the product this run actually is. It used to
         be a hardcoded product word inside ReportFrame, so a knockout announced itself as a clearance on
         every knockout ever published — the shell contradicting the document it framed.
         `heading` is the NAME being read: the run's on a single-document run, and the one picked name
         on a batch — so a reader with two of a batch's names open in two tabs can tell them apart. */
      /* @__PURE__ */ jsxRuntimeExports.jsx(
        ReportFrame,
        {
          src: doc,
          title: product ? `${product} — ${heading}` : heading,
          frameRef: frame.ref,
          height: frame.height
        }
      )
    ) : missing ? (
      /* A SLUG THAT NAMES NOTHING SAYS SO. The tempting repair is to fall through to the family list,
         which turns a stale or mistyped link into a silent redirect — the reader asked for one name
         and is shown the whole batch with no word about why. The list is one press away below. */
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "notice", style: { marginTop: 20 }, role: "alert", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("b", { children: "That name is not in this search" }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { style: { margin: "6px 0 10px", color: "var(--text-muted)" }, children: [
          "This search has no report for ",
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "mono", children: markSlug }),
          ". It may have been published under a different name, or the link may be from an older version of this search."
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("button", { type: "button", className: "nav-item", style: { width: "auto", margin: 0 }, onClick: () => ctx.go(family), children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(Icon, { name: "chevron-left", size: 14 }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "All names in this search" })
        ] })
      ] })
    ) : run.reports.length > 1 ? /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
      assessment.length ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "notice", style: { marginTop: 20 }, "data-anon": "mark", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "eyebrow", children: "Assessment" }),
        assessment.map((p, i) => /* @__PURE__ */ jsxRuntimeExports.jsx(SummaryBlocks, { chunk: p, first: i === 0 }, i))
      ] }) : null,
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "notice", style: { marginTop: 20 }, children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("b", { children: [
          run.productName ? `${run.productName} · ` : "",
          run.reports.length,
          " reports — one per name"
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { style: { margin: "6px 0 10px", color: "var(--text-muted)" }, children: [
          "This knockout screened ",
          run.reports.length,
          " names. Each has its own report."
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("ul", { style: { margin: 0, paddingLeft: 18 }, children: run.reports.map((r) => {
          const slug = r.slug;
          return /* @__PURE__ */ jsxRuntimeExports.jsx("li", { style: { margin: "4px 0" }, children: slug ? /* @__PURE__ */ jsxRuntimeExports.jsx(
            "button",
            {
              type: "button",
              className: "link-btn",
              style: { fontSize: "inherit", textDecoration: "none" },
              onClick: () => ctx.go(resultPath(run.runId, slug)),
              children: r.mark ?? slug
            }
          ) : /* @__PURE__ */ jsxRuntimeExports.jsx("a", { href: r.path, children: r.mark ?? r.path }) }, r.path);
        }) })
      ] })
    ] }) : /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "notice", style: { marginTop: 20 }, children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("b", { children: "No report yet" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("p", { style: { margin: "6px 0 0", color: "var(--text-muted)" }, children: "This search has not produced a report yet." })
    ] })
  ] });
}
function ReportFrame({
  src,
  title,
  frameRef,
  height
}) {
  return (
    // The PAGE owns the only scrollbar, and the frame is as tall as its document.
    //
    // This has now been wrong in both directions, so both are worth recording. Originally the frame had a
    // fixed height inside a scrolling page: the report scrolled in its own box while the page scrolled
    // behind it, two scrollbars for one document and neither reaching the end. The fix was to lock the
    // screen to the viewport and let the frame scroll alone — one scrollbar, correct, and it made the
    // report the only screen in the portal that did not behave like a page. The sidebar and header were
    // pinned by a different mechanism from every other screen, and the reader lost the browser scrollbar
    // as a sense of how much document was left.
    //
    // A frame cannot size itself to a cross-origin document, and this one is deliberately null-origin, so
    // the document measures ITSELF and posts the number out (the bridge injected by portal-report.mjs).
    // The page then scrolls normally, .sidebar and .topbar stay put on their existing position:sticky,
    // and there is still exactly one scrollbar. The sandbox is untouched.
    //
    // There is also no explanatory banner here any more. It apologised for the report rendering in its
    // own light theme, which is not something a reader should be told about a document they asked to
    // read — the honest fix was to stop it looking wrong, not to caption it.
    // `data-anon` sits on the CONTAINER, and that is the only place it can sit.
    //
    // The screen-share blur is a CSS filter driven by `html.anon-on [data-anon='mark']` (base.css).
    // Inside the frame it has no reach at all: the document has a null origin, so the parent's
    // stylesheet does not apply to it and no script can add markup to it. The report also carries no
    // per-name tagging of its own. For a while the Preferences screen simply CLAIMED the blur covered
    // the report, which was untrue in the one situation the feature exists for — a lawyer sharing a
    // screen with a client's report open.
    //
    // A filter on an ancestor rasterises the iframe along with it, so tagging the container makes the
    // promise true. The trade is that the WHOLE document blurs rather than just the names in it, which
    // for a screen-share is the safer direction: the alternative was covering nothing.
    /* @__PURE__ */ jsxRuntimeExports.jsx("div", { "data-anon": "mark", style: { marginTop: 12 }, children: /* @__PURE__ */ jsxRuntimeExports.jsx(
      "iframe",
      {
        ref: frameRef,
        src,
        title,
        sandbox: "allow-scripts allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads",
        scrolling: "auto",
        style: { height, width: "100%", border: 0, display: "block" }
      }
    ) })
  );
}
function Missing({ go, reason }) {
  return /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "screen report", children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "empty", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx("p", { children: reason === "notFound" ? "That clearance is not available." : "The clearance could not be loaded just now." }),
    /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "nav-item", style: { width: "auto", margin: "0 auto" }, onClick: () => go("/portal/clearances"), children: "Back to Clearances" })
  ] }) });
}
function parseNames(raw) {
  return raw.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
}
function parseList(raw) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const part of raw.split(/[,\n]/)) {
    const t = part.trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}
const EMPTY_DRAFT = { product: null, territories: [], nativeLanguage: false };
const REGIONS = ["European Union", "Benelux", "African Regional (ARIPO)"];
const COUNTRIES = [
  "United States",
  "United Kingdom",
  "Ireland",
  "France",
  "Germany",
  "Spain",
  "Italy",
  "Netherlands",
  "Switzerland",
  "Austria",
  "Sweden",
  "Norway",
  "Poland",
  "Bulgaria",
  "Greece",
  "Turkey",
  "Canada",
  "Mexico",
  "Brazil",
  "Argentina",
  "China",
  "Hong Kong",
  "Taiwan",
  "Macau",
  "Japan",
  "South Korea",
  "Singapore",
  "India",
  "Thailand",
  "Australia",
  "New Zealand",
  "United Arab Emirates",
  "Saudi Arabia",
  "South Africa"
];
const ALIASES$1 = {
  "European Union": ["eu", "europe"],
  "United States": ["us", "usa", "america"],
  "United Kingdom": ["uk", "britain", "gb", "england"]
};
function tierOf(name) {
  if (REGIONS.includes(name)) return "region";
  if (COUNTRIES.includes(name)) return "country";
  return null;
}
function offerableFor(product) {
  if (!product) return [];
  return product.geography === "exactly one country" ? COUNTRIES : [...REGIONS, ...COUNTRIES];
}
function reachesTerritory(name, covered) {
  if (!Array.isArray(covered)) return true;
  return covered.includes(name);
}
function vocabularyFor(product, covered) {
  if (!product) return [];
  return offerableFor(product).filter((n) => reachesTerritory(n, covered));
}
function territoryMatches(query, chosen, product, limit = 8, _covered) {
  return matchTerritoriesIn(offerableFor(product), query, chosen, limit);
}
function matchTerritoriesIn(vocabulary, query, chosen, limit = 8) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const taken = new Set(chosen.map((c) => c.trim().toLowerCase()));
  const hit = (name) => {
    const lower = name.toLowerCase();
    if (lower.startsWith(q)) return true;
    if (lower.split(/[\s(/]+/).some((w) => w.startsWith(q))) return true;
    return (ALIASES$1[name] ?? []).some((a) => a.startsWith(q));
  };
  return vocabulary.filter((n) => !taken.has(n.toLowerCase()) && hit(n)).slice(0, limit);
}
function addTerritory(d, name, product, _covered) {
  if (!offerableFor(product).includes(name)) return d;
  if (d.territories.includes(name)) return d;
  if ((product == null ? void 0 : product.geography) === "exactly one country") return { ...d, territories: [name] };
  return { ...d, territories: [...d.territories, name] };
}
function removeTerritory(d, name) {
  return { ...d, territories: d.territories.filter((t) => t !== name) };
}
function geographyFor(d) {
  return d.territories.length ? { mode: "named", territories: [...d.territories] } : { mode: "worldwide", territories: [] };
}
function nativeLanguageControl(product) {
  if ((product == null ? void 0 : product.nativeLanguage) === "offered") return "toggle";
  if ((product == null ? void 0 : product.nativeLanguage) === "automatic") return "automatic";
  return "none";
}
function toggleNativeLanguage(d, product) {
  if (nativeLanguageControl(product) !== "toggle") return d;
  return { ...d, nativeLanguage: !d.nativeLanguage };
}
function chooseProduct(d, product) {
  const territories = (product == null ? void 0 : product.geography) === "worldwide, and nothing else" ? [] : (product == null ? void 0 : product.geography) === "exactly one country" ? d.territories.filter((t) => tierOf(t) === "country").slice(0, 1) : d.territories;
  return {
    product: (product == null ? void 0 : product.key) ?? null,
    territories,
    nativeLanguage: nativeLanguageControl(product) === "toggle" ? d.nativeLanguage : false
  };
}
function geographyNote(product) {
  if (!product) return null;
  switch (product.geography) {
    case "worldwide, and nothing else":
      return "Worldwide. This search is not narrowed — that is what it is. To search particular places, pick a different search above.";
    case "exactly one country":
      return "One country. Regions are not offered here: the case-law and opposition reading is per-country practice, and there is no such thing as one region’s precedent.";
    case "a region, or two or more countries":
      return "A region, or two or more countries. One country on its own is a Full country search — pick that one instead.";
    default:
      return "Worldwide, or any set of territories you name.";
  }
}
function nameBudget(product, names) {
  if (!product || names <= product.maxNames) return null;
  return { allowed: product.maxNames, over: names - product.maxNames };
}
function blockers(d, product, names = 0) {
  const out = [];
  if (!product) {
    out.push("Pick a search above. The four differ in where they look and how deep they read.");
    return out;
  }
  const budget = nameBudget(product, names);
  if (budget) {
    out.push(budget.allowed === 1 ? `A ${product.name} reads one name at a time, and you have ${budget.allowed + budget.over}.` : `A ${product.name} reads ${budget.allowed} names at a time, and you have ${budget.allowed + budget.over}.`);
  }
  const named = d.territories;
  const countries = named.filter((t) => tierOf(t) === "country");
  const regions = named.filter((t) => tierOf(t) === "region");
  switch (product.geography) {
    case "worldwide, and nothing else":
      if (named.length) out.push(`A ${product.name} is worldwide and is not narrowed. Remove the territories, or pick a Multi-country focus search to read them.`);
      break;
    case "a region, or two or more countries":
      if (!named.length) out.push(`A ${product.name} reads a region, or two or more countries. Name them in Where — or pick a Global preliminary search to read the whole world.`);
      else if (named.length === 1 && countries.length === 1) out.push(`A ${product.name} reads a region, or two or more countries. Add another country or name a region — or pick a Full country search to read ${countries[0]} on its own.`);
      break;
    case "exactly one country":
      if (!named.length) out.push(`A ${product.name} reads one country. Name it in Where.`);
      else if (regions.length) out.push(`A ${product.name} reads one country, and ${regions[0]} is a region. Name one of its countries instead.`);
      break;
  }
  if (named.length > MAX_TERRITORIES)
    out.push(`That is ${named.length} territories — a search takes at most ${MAX_TERRITORIES}. Remove some.`);
  if (!product.available) out.push(product.unavailableNote || "That search is not available just now.");
  return out;
}
const ALL_TERRITORIES$1 = [...REGIONS, ...COUNTRIES];
const isKnownTerritory = (entry) => {
  const e = String(entry).trim().toLowerCase();
  return e.length > 0 && ALL_TERRITORIES$1.some((t) => t.toLowerCase() === e);
};
const MAX_TERRITORIES = 20;
function machineryFor(d, product) {
  const knockout = (product == null ? void 0 : product.pipeline) === "knockout";
  return {
    pipeline: knockout ? "knockout" : "clearance",
    caseLaw: (product == null ? void 0 : product.caseLaw) === true,
    // What the SCREEN can know. Whether a lane actually fires is decided server-side from the
    // territories, and the review step quotes the server's figure — which is what that step is for.
    nativeLanguage: (product == null ? void 0 : product.nativeLanguage) === "automatic" || (product == null ? void 0 : product.nativeLanguage) === "offered" && d.nativeLanguage,
    registerCounts: knockout && ((product == null ? void 0 : product.components) ?? []).includes("registerProbe"),
    territories: [...d.territories]
  };
}
const SAFE_GRID_CELLS = 98;
const DENSE_GRID_CELLS = 16;
const checksPerName = (platforms) => Math.max(1, platforms + 1);
const gridBudget = (density) => density === "dense" ? DENSE_GRID_CELLS : SAFE_GRID_CELLS;
const batchSize = (platforms, density) => Math.max(1, Math.floor(gridBudget(density) / checksPerName(platforms)));
const nativeActive = (m) => m.pipeline === "clearance" && m.nativeLanguage;
const countsActive = (m) => m.pipeline === "knockout" && m.registerCounts;
const caseLawActive = (m) => m.pipeline === "clearance" && m.caseLaw;
const variantCount = (m) => 20 + (nativeActive(m) ? 6 : 0);
const gridCalls = (i) => Math.ceil(variantCount(i.levers) / batchSize(i.platforms, i.density));
const runCount = (i) => i.levers.pipeline === "knockout" ? 1 : Math.max(1, i.names);
const W = {
  gridPerCheck: 1.1,
  gridPerCall: 0.8,
  registerBase: 14,
  registerPerClass: 2,
  caseLaw: 6,
  script: 8,
  oneTerritory: 9,
  knockoutBase: 1,
  knockoutPerName: 0.4,
  countPerName: 0.5
};
function effortRaw(i) {
  const names = Math.max(1, i.names);
  if (i.levers.pipeline === "knockout")
    return W.knockoutBase + names * (W.knockoutPerName + (countsActive(i.levers) ? W.countPerName : 0));
  let e = checksPerName(i.platforms) * W.gridPerCheck + gridCalls(i) * W.gridPerCall;
  e += W.registerBase + Math.max(i.classes, 1) * W.registerPerClass;
  if (caseLawActive(i.levers)) e += W.caseLaw;
  if (nativeActive(i.levers)) e += W.script;
  if (i.levers.territories.length === 1) e += W.oneTerritory;
  return e * runCount(i);
}
const effortFloor = (i) => effortRaw({
  ...i,
  names: 1,
  levers: { pipeline: "knockout", caseLaw: false, nativeLanguage: false, registerCounts: true, territories: [] }
});
const effortCeiling = (i) => effortRaw({
  ...i,
  names: 1,
  levers: { pipeline: "clearance", caseLaw: true, nativeLanguage: true, registerCounts: false, territories: ["United States"] }
});
function effortUnits(i) {
  const raw = effortRaw(i);
  if (raw <= 0) return 1;
  const span = effortCeiling(i) - effortFloor(i);
  if (!(span > 0)) return 1;
  return Math.max(1, Math.min(10, Math.round(1 + 9 * ((raw - effortFloor(i)) / span))));
}
const costBand = (i) => Math.max(1, Math.min(5, Math.ceil(effortUnits(i) / 2)));
const TURNAROUND_QUOTE = {
  clearance: { lowHours: 1.5, highHours: 2.5 },
  // — 5-10 minutes, a range. Mirrors the server; the parity test pins both.
  knockout: { lowHours: 5 / 60, highHours: 10 / 60 }
};
const quoteBoundsFor = (m) => m.pipeline === "knockout" ? TURNAROUND_QUOTE.knockout : TURNAROUND_QUOTE.clearance;
const turnaroundBounds = (i) => ({ ...quoteBoundsFor(i.levers) });
const fmtHours = (h) => h % 1 ? h.toFixed(1) : String(h);
function turnaround(i) {
  const { lowHours, highHours } = turnaroundBounds(i);
  if (highHours < 1) {
    const lo = Math.round(lowHours * 60), hi = Math.round(highHours * 60);
    return lo === hi ? `~${hi} min` : `${lo}–${hi} min`;
  }
  if (lowHours === highHours) return `~${fmtHours(highHours)} ${highHours === 1 ? "hour" : "hours"}`;
  return `${fmtHours(lowHours)}–${fmtHours(highHours)} hours`;
}
function checksSummary(i) {
  if (i.levers.pipeline === "knockout")
    return countsActive(i.levers) ? "1 broad sweep per name · web + marketplaces · register filing counts" : "1 broad sweep per name · web + marketplaces";
  return `${checksPerName(i.platforms)} checks per name`;
}
function runsNote(i) {
  const runs = runCount(i);
  if (runs < 2) return "";
  return `Runs as ${runs} separate searches — ${runs}× the work.`;
}
function composeSaved({
  label,
  draft,
  classes,
  platforms,
  notes,
  prior
}) {
  if (!draft.product) return null;
  const carried = { ...prior ?? {} };
  for (const k of ["version", "createdBy", "createdAt", "updatedBy", "updatedAt"]) delete carried[k];
  const priorComponents = carried["components"];
  const components = {
    ...typeof priorComponents === "object" && priorComponents !== null && !Array.isArray(priorComponents) ? priorComponents : {}
  };
  delete components["jxLanes"];
  delete components["registerProbe"];
  const out = {
    ...carried,
    label: label.trim(),
    base: draft.product,
    components,
    scope: {
      jurisdictions: [...draft.territories],
      platforms: [...platforms],
      classes: [...classes]
    },
    nativeLanguage: draft.nativeLanguage
  };
  delete out["caseLaw"];
  if (prior === void 0) out["archived"] = false;
  if (notes !== void 0) {
    if (notes.trim()) out["notes"] = notes.trim();
    else delete out["notes"];
  }
  return out;
}
function draftFromSaved(recipe, products) {
  const base = typeof recipe["base"] === "string" ? recipe["base"] : "";
  const product = products.find((p) => p.key === base) ?? null;
  if (!product) return null;
  const scope = typeof recipe["scope"] === "object" && recipe["scope"] !== null && !Array.isArray(recipe["scope"]) ? recipe["scope"] : {};
  const territories = Array.isArray(scope["jurisdictions"]) ? scope["jurisdictions"].filter((j) => typeof j === "string") : [];
  return chooseProduct({
    territories,
    nativeLanguage: recipe["nativeLanguage"] === true
  }, product);
}
const numbers = (v) => Array.isArray(v) ? v.filter((n) => typeof n === "number") : [];
const strings = (v) => Array.isArray(v) ? v.filter((s) => typeof s === "string") : [];
function inherited({
  profile,
  projectEffective,
  projectOrigins,
  ownerLabel,
  projectLabel
}) {
  const source = projectEffective ?? profile ?? {};
  const fromProject = (projectOrigins == null ? void 0 : projectOrigins["defaultClasses"]) === "project";
  return {
    classes: [...numbers(source["defaultClasses"])].sort((a, b) => a - b),
    classesFrom: fromProject && projectLabel ? `from ${projectLabel}` : `from ${ownerLabel}`,
    territories: strings(source["defaultJurisdictions"]),
    territoriesFrom: (projectOrigins == null ? void 0 : projectOrigins["defaultJurisdictions"]) === "project" && projectLabel ? `from ${projectLabel}` : `from ${ownerLabel}`,
    platforms: strings(source["platforms"]),
    density: typeof source["marketplaceDensity"] === "string" ? source["marketplaceDensity"] : null
  };
}
const MARKERS = {
  full: { glyph: "●", name: "Included" },
  partial: { glyph: "◐", name: "Partly" },
  optional: { glyph: "+", name: "Optional" },
  absent: { glyph: "○", name: "Not on this depth" }
};
const LEGEND = Object.keys(MARKERS).map((k) => MARKERS[k]);
const has = (level, component) => level.components.includes(component);
const isClearance = (level) => level.pipeline === "clearance";
const UNSTATED = "—";
const cell = (marker, text) => ({
  marker,
  glyph: marker ? MARKERS[marker].glyph : "",
  srLabel: marker ? MARKERS[marker].name : "",
  text
});
const ROWS = [
  {
    label: "Trademark registers",
    // A quick screen's register axis is a COUNT (Stage 0.5) and not a search: it fetches no records
    // and reads none. Calling both "searched" would sell the count as the sweep.
    cell: (l) => isClearance(l) ? cell("full", "Searched") : has(l, "registerProbe") ? cell("partial", "Filing counts only") : cell("absent", "Not searched")
  },
  {
    label: "Marketplace & common-law",
    // A knockout IS the marketplace product — what it lacks is the grid's structure, not the coverage.
    // The `absent` arm is unreachable from today's payload: the one clearance that dropped the grid was
    // retired and the menu is built from the orderable registry. It stays because this table
    // renders whatever the server sends, and inventing coverage for a level it does not recognise is the
    // one thing a coverage table must never do.
    //
    // THE KNOCKOUT CELL IS `full`, AND A REVIEWER WILL WANT `partial`. It must not be. Reading
    // `commonLawGrid: false` on a knockout as "does not search marketplaces" is precisely the
    // 2026-07-21 composer off-by-one that routed 20-name knockout requests into one-name clearances at
    // roughly twenty times the cost. `partial` would re-encode that bug as a glyph. The structural
    // difference between a sweep and a grid lives in the TEXT, which is where it belongs.
    cell: (l) => l.pipeline === "knockout" ? cell("full", "One broad sweep per name") : has(l, "commonLawGrid") ? cell("full", "Full grid — every shop, term by term") : cell("absent", "Not searched")
  },
  {
    label: "Native language",
    // Transliteration is standard on every clearance and is not the toggle. What the investigation buys
    // is the native marketplaces and native registers, so a clearance without it is `partial` (the mark
    // IS searched in the scripts its territories register in) and never `absent`. THREE states,
    // because the offering has three: automatic here, a choice there, not sold at all on the other two.
    cell: (l) => l.nativeLanguage === "automatic" ? cell("full", "Runs automatically — native registers and shops in that country’s language") : l.nativeLanguage === "offered" ? cell("optional", "Optional — the one thing on this list you choose") : isClearance(l) ? cell("partial", "Transliteration only (the scripts its territories register in)") : cell("absent", "Not included")
  },
  {
    label: "Case law",
    // `full` or `absent`, and NEVER `optional`. It used to read "Optional — one country per deep dive"
    // on every clearance, which was the truth about a LEVER: case law was a flag you added. It is a
    // PRODUCT now, so on the one search that carries it the answer is "yes, that is what this is", and
    // everywhere else it is "not sold here" — which is a different sentence from "you did not tick it".
    cell: (l) => l.caseLaw ? cell("full", "The case-law and opposition reading — this is the search that carries it") : cell("absent", "Not part of this search")
  },
  {
    label: "Where it looks",
    // STRAIGHT FROM THE OFFERING. The geography is the other half of what distinguishes these four, and
    // a table that compared machinery while staying silent about where each one points was comparing
    // half the product. No marker: it is a statement, not a coverage claim.
    cell: (l) => cell(null, l.geography || UNSTATED)
  },
  {
    label: "Names per search",
    // No marker: a marker on a quantity means nothing, and a glyph column that is sometimes a claim and
    // sometimes decoration is worse than no glyph at all. The figure is the SERVER'S, so this cell can
    // never promise a count the wall does not enforce.
    cell: (l) => cell(null, String(l.maxNames))
  },
  {
    label: "Turnaround",
    // "from", because this is the product's FLOOR and not a quote: a single-territory dig and a native
    // lane each add to it, and a bare figure here would read as the whole answer. The composer's footer
    // carries the computed one for the search actually being built.
    cell: (l) => cell(null, l.baseTurnaround ? `from ${l.baseTurnaround}` : UNSTATED)
  }
];
const byEffort = (products) => products.map((l, i) => ({ l, i })).sort((a, b) => (a.l.baseTurnaroundHours ?? Infinity) - (b.l.baseTurnaroundHours ?? Infinity) || a.i - b.i).map((x) => x.l);
function productMatrix(unordered, currentKey = null) {
  const levels = byEffort(unordered);
  const columns = levels.map((l) => ({
    key: l.key,
    // `|| stageLabel` is the degradation rule this file already applies to `available`: an older server
    // that sends no name gets the label rather than a blank header.
    name: l.name || l.stageLabel,
    stageLabel: l.stageLabel,
    current: currentKey != null && l.key === currentKey,
    available: l.available,
    unavailableNote: l.available ? null : l.unavailableNote
  }));
  return {
    columns,
    rows: ROWS.map((r) => ({ label: r.label, cells: levels.map((l) => r.cell(l)) }))
  };
}
const NICE_CLASSES = {
  1: "Chemicals",
  2: "Paints",
  3: "Cosmetics & cleaning",
  4: "Fuels",
  5: "Pharmaceuticals",
  6: "Metals",
  7: "Machines",
  8: "Hand tools",
  9: "Electrical & software",
  10: "Medical devices",
  11: "Lighting & heating",
  12: "Vehicles",
  13: "Firearms",
  14: "Jewellery",
  15: "Instruments",
  16: "Paper & printed",
  17: "Rubber & plastics",
  18: "Leather goods",
  19: "Building materials",
  20: "Furniture",
  21: "Household utensils",
  22: "Ropes & textiles",
  23: "Yarns",
  24: "Fabrics",
  25: "Clothing",
  26: "Lace & trimmings",
  27: "Floor coverings",
  28: "Games & sporting goods",
  29: "Meat & prepared foods",
  30: "Coffee, snacks & staples",
  31: "Fresh produce",
  32: "Non-alcoholic drinks",
  33: "Alcoholic drinks",
  34: "Tobacco",
  35: "Advertising & retail",
  36: "Financial",
  37: "Construction & repair",
  38: "Telecommunications",
  39: "Transport",
  40: "Treatment of materials",
  41: "Education & entertainment",
  42: "Science & technology",
  43: "Food & drink services",
  44: "Medical & beauty",
  45: "Legal & security"
};
const ALL_CLASSES = Object.keys(NICE_CLASSES).map(Number);
const isClassNumber = (n) => typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 45;
function classLabel(n) {
  const heading = NICE_CLASSES[n];
  return heading ? `${n} · ${heading}` : String(n);
}
const ALIASES = {
  3: ["perfume", "soap", "skincare"],
  5: ["pharma", "medicine", "supplements"],
  9: ["software", "app", "apps", "computer", "hardware", "electronics"],
  25: ["apparel", "footwear", "shoes", "fashion"],
  28: ["toys", "sport", "sports"],
  30: ["coffee", "tea", "snacks"],
  32: ["beer", "water", "juice", "soft drinks", "energy drinks"],
  33: ["wine", "spirits", "alcohol"],
  35: ["retail", "marketing", "advertising", "shop", "ecommerce", "e-commerce"],
  36: ["finance", "insurance", "banking", "crypto"],
  38: ["telecoms", "telecom", "streaming"],
  41: ["education", "training", "entertainment", "games", "publishing"],
  42: ["saas", "software services", "tech", "technology", "research", "design"],
  43: ["restaurant", "cafe", "hotel", "catering"],
  44: ["clinic", "salon", "beauty", "healthcare"],
  45: ["legal", "law", "security"]
};
function classMatches(query, chosen, limit = 8) {
  const q = query.trim().toLowerCase().replace(/^(class|cl\.?)\s+/, "");
  if (!q) return [];
  const free = (n) => !chosen.includes(n);
  if (/^\d{1,2}$/.test(q)) {
    const n = Number(q);
    return isClassNumber(n) && free(n) ? [n] : [];
  }
  const hit = (n) => {
    const words = `${NICE_CLASSES[n] ?? ""}`.toLowerCase().split(/[\s&,]+/).filter(Boolean);
    if (words.some((w) => w.startsWith(q))) return true;
    return (ALIASES[n] ?? []).some((a) => a.startsWith(q) || a.split(/\s+/).some((w) => w.startsWith(q)));
  };
  return ALL_CLASSES.filter((n) => free(n) && hit(n)).slice(0, limit);
}
const ALL_TERRITORIES = [...REGIONS, ...COUNTRIES];
function resolveTerritory(raw) {
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const q = norm(raw);
  if (!q) return null;
  return ALL_TERRITORIES.find((t) => norm(t) === q) ?? null;
}
function resolveRead(raw) {
  const dropped = [];
  const territories = [];
  let claimedWorldwide = false;
  if (raw.worldwide) claimedWorldwide = true;
  for (const t of raw.territories) {
    if (/^\s*(worldwide|global|everywhere|all)\s*$/i.test(t)) {
      claimedWorldwide = true;
      continue;
    }
    const hit = resolveTerritory(t);
    if (hit === null) {
      dropped.push(t);
      continue;
    }
    if (!territories.includes(hit)) territories.push(hit);
  }
  const classes = [];
  for (const c of raw.classes) if (isClassNumber(c) && !classes.includes(c)) classes.push(c);
  return {
    read: { ...raw, territories, classes, names: raw.names.filter((n) => n.trim() !== "") },
    dropped,
    worldwide: claimedWorldwide && territories.length === 0
  };
}
function applyRead(draft, read, inheritedClasses = [], opts = {}) {
  const names = read.names.length > 0 ? read.names.join("\n") : draft.names;
  const base = draft.classes ?? inheritedClasses;
  const newClasses = read.classes.filter((c) => !base.includes(c));
  return {
    names,
    // And a ghost that gains NOTHING stays a ghost. A brief that names class 32 for an owner who
    // already carries 32 has changed nothing the user can see — converting the list to an explicit one
    // anyway would freeze today's profile into the request, so a class added to the brand owner
    // tomorrow would silently not apply to a search composed today.
    classes: newClasses.length > 0 || draft.classes !== null && read.classes.length > 0 ? [...base, ...newClasses] : draft.classes,
    goods: read.goods.trim() !== "" ? read.goods : draft.goods,
    ref: read.ref.trim() !== "" ? read.ref : draft.ref,
    deadline: read.deadline !== "" ? read.deadline : draft.deadline,
    draft: {
      ...draft.draft,
      // A brief that names a product REPLACES the choice; a brief that does not leaves it alone. Null is
      // silence, and silence must never be read as "the cheapest" or as "the deepest".
      product: read.product ?? draft.draft.product,
      territories: read.territories.length > 0 ? [...draft.draft.territories, ...read.territories.filter((t) => !draft.draft.territories.includes(t))] : opts.worldwide === true ? [] : draft.draft.territories
    }
  };
}
function appliedNotes(before, after, inheritedClasses = [], products = []) {
  var _a;
  const out = [];
  if (after.names !== before.names) {
    const list = after.names.split("\n").map((s) => s.trim()).filter(Boolean);
    out.push(list.length === 1 ? `${list[0]} — the mark` : `${list.length} names — ${list.join(", ")}`);
  }
  const beforeClasses = before.classes ?? inheritedClasses;
  const addedClasses = (after.classes ?? []).filter((c) => !beforeClasses.includes(c));
  if (addedClasses.length > 0) out.push(`Class${addedClasses.length > 1 ? "es" : ""} ${addedClasses.map(classLabel).join(", ")}`);
  if (after.goods !== before.goods) out.push(`Goods — ${after.goods}`);
  const addedT = after.draft.territories.filter((t) => !before.draft.territories.includes(t));
  if (addedT.length > 0) out.push(addedT.join(", "));
  else if (before.draft.territories.length > 0 && after.draft.territories.length === 0)
    out.push("Worldwide — the named territories were cleared");
  if (after.draft.product !== before.draft.product && after.draft.product)
    out.push(((_a = products.find((p) => p.key === after.draft.product)) == null ? void 0 : _a.name) ?? after.draft.product);
  if (after.ref !== before.ref) out.push(`Your reference — ${after.ref}`);
  if (after.deadline !== before.deadline) out.push(`Deadline ${after.deadline}`);
  return out;
}
function useUnsaved(dirty) {
  const ref = reactExports.useRef(dirty);
  ref.current = dirty;
  reactExports.useEffect(() => registerGuard(() => ref.current), []);
}
function readProblem(r) {
  switch (r.kind) {
    case "reject":
    case "collision":
    case "clarify":
      return ("errors" in r ? r.errors : r.questions).join(" ");
    case "gate":
    case "conflict":
    case "upstream":
      return r.message;
    case "rateLimited":
      return "That is a lot of reading in one hour — set this one up below.";
    case "tooLarge":
      return "That brief is too long to send — paste the part that matters.";
    default:
      return "That could not be read — set the search up below.";
  }
}
const EMPTY = {
  pick: EMPTY_DRAFT,
  savedSearch: "",
  project: "",
  names: "",
  classes: null,
  goods: "",
  platforms: "",
  ref: "",
  deadline: "",
  instructions: "",
  brief: ""
};
function NewClearance({ ctx }) {
  var _a, _b, _c, _d;
  const account = ctx.owner;
  const needsOwner = ctx.me.allAccounts && account === null;
  const { result: searches, reload: retrySearches } = useLoad(() => api.searches(account), [account]);
  const { result: profileRes } = useLoad(() => api.profile(account), [account]);
  const { result: projectsRes } = useLoad(() => api.projects(account), [account]);
  const { result: usageRes } = useLoad(() => api.usage(account), [account]);
  const levels = (searches == null ? void 0 : searches.kind) === "ok" ? searches.value.products : [];
  const registerTerritories = (searches == null ? void 0 : searches.kind) === "ok" ? searches.value.registerTerritories : void 0;
  const savedSearches = (searches == null ? void 0 : searches.kind) === "ok" ? searches.value.recipes : [];
  const readCan = (searches == null ? void 0 : searches.kind) === "ok" ? searches.value.read : { available: false, maxBrief: 12e3, note: null };
  const projects = ((projectsRes == null ? void 0 : projectsRes.kind) === "ok" ? projectsRes.value : []).filter((p) => !p.archived);
  const profile = (profileRes == null ? void 0 : profileRes.kind) === "ok" ? profileRes.value : null;
  const usage = (usageRes == null ? void 0 : usageRes.kind) === "ok" ? usageRes.value : null;
  const [entry, setEntry] = reactExports.useState(null);
  const [draft, setDraft] = reactExports.useState(EMPTY);
  const [territoryQuery, setTerritoryQuery] = reactExports.useState("");
  const [classQuery, setClassQuery] = reactExports.useState("");
  const [showAllShops, setShowAllShops] = reactExports.useState(false);
  const [saveOpen, setSaveOpen] = reactExports.useState(false);
  const [saveName, setSaveName] = reactExports.useState("");
  const [saveText, setSaveText] = reactExports.useState("");
  const [saveNote, setSaveNote] = reactExports.useState(null);
  const [plan, setPlan] = reactExports.useState(null);
  const [runFailure, setRunFailure] = reactExports.useState(null);
  const [busy, setBusy] = reactExports.useState(false);
  const [problem, setProblem] = reactExports.useState(null);
  const [submitted, setSubmitted] = reactExports.useState(null);
  const composerDirty = reactExports.useMemo(
    () => submitted == null && JSON.stringify(draft) !== JSON.stringify(EMPTY),
    [draft, submitted]
  );
  useUnsaved(composerDirty);
  const { result: projectRes } = useLoad(
    () => draft.project ? api.project(account, draft.project) : Promise.resolve({ kind: "ok", value: null }),
    [account, draft.project]
  );
  const projectDetail = projectRes && projectRes.kind === "ok" ? projectRes.value : null;
  const editingSlug = reactExports.useMemo(
    () => new URLSearchParams(window.location.search).get("search") || null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  const { result: editingRes } = useLoad(
    () => editingSlug ? api.savedSearch(account, editingSlug) : Promise.resolve({ kind: "ok", value: null }),
    [account, editingSlug]
  );
  const editing = (editingRes == null ? void 0 : editingRes.kind) === "ok" ? editingRes.value : null;
  const editingPick = reactExports.useMemo(() => editing ? draftFromSaved(editing.recipe, levels) : null, [editing, levels]);
  const hydrated = reactExports.useRef(null);
  reactExports.useEffect(() => {
    if (!editing || !editingPick) return;
    if (hydrated.current === editing.sha) return;
    hydrated.current = editing.sha;
    const scope = editing.recipe["scope"] ?? {};
    const classes2 = Array.isArray(scope["classes"]) ? scope["classes"].filter((c) => typeof c === "number") : [];
    const platforms = Array.isArray(scope["platforms"]) ? scope["platforms"].filter((p) => typeof p === "string") : [];
    setDraft((d) => ({
      ...d,
      pick: editingPick,
      // NOT `savedSearch`: that key means "run this saved search as-is", which hides the picker. Editing
      // is the opposite — the product and its geography ARE the thing being edited, so they are set
      // directly.
      savedSearch: "",
      // [] and null are different statements here (see Draft.classes). A saved search that names no
      // class is inheriting, so it hydrates as null, not as "the user cleared every class".
      classes: classes2.length ? classes2 : null,
      platforms: platforms.join(", ")
    }));
    setEntry("manual");
    setSaveOpen(true);
    setSaveName(typeof editing.recipe["label"] === "string" ? editing.recipe["label"] : "");
    setSaveText(typeof editing.recipe["notes"] === "string" ? editing.recipe["notes"] : "");
  }, [editing, editingPick]);
  const names = reactExports.useMemo(() => parseNames(draft.names), [draft.names]);
  const ownerLabel = account ? ctx.ownerName(account) : "this brand owner";
  const projectLabel = ((_a = projects.find((p) => p.key === draft.project)) == null ? void 0 : _a.name) || draft.project || null;
  const own = reactExports.useMemo(
    () => inherited({
      profile: (profile == null ? void 0 : profile.profile) ?? null,
      projectEffective: (projectDetail == null ? void 0 : projectDetail.effective) ?? null,
      projectOrigins: (projectDetail == null ? void 0 : projectDetail.origins) ?? null,
      ownerLabel,
      projectLabel
    }),
    [profile, projectDetail, ownerLabel, projectLabel]
  );
  const classes = draft.classes ?? own.classes;
  const savedRow = draft.savedSearch ? savedSearches.find((r) => r.slug === draft.savedSearch) ?? null : null;
  const activeBase = draft.savedSearch ? (savedRow == null ? void 0 : savedRow.base) ?? draft.pick.product : draft.pick.product;
  const activeLevel = reactExports.useMemo(() => levels.find((l) => l.key === activeBase) ?? null, [levels, activeBase]);
  const activePipeline = (activeLevel == null ? void 0 : activeLevel.pipeline) ?? null;
  const marketplacesApply = activePipeline !== "knockout";
  const geoNote = geographyNote(activeLevel);
  const nativeControl = nativeLanguageControl(activeLevel);
  const machinery = machineryFor(draft.pick, activeLevel);
  const knockout = reactExports.useMemo(
    () => levels.filter((l) => l.available && l.maxNames > 1).sort((a, b) => b.maxNames - a.maxNames)[0] ?? null,
    [levels]
  );
  const effort = {
    levers: machinery,
    names: names.length,
    classes: classes.length,
    // The account's shops PLUS any typed for this search. Without the second half, promoting the add
    // control above would have made it a control that changes the search and reports nothing: extras go
    // on the wire (`bodyFor`), the engine runs a grid column for each, and checksPerName / effortUnits /
    // costBand / the footer would all have sat still while it did.
    platforms: marketplacesApply ? own.platforms.length + parseList(draft.platforms).length : 0,
    density: own.density
  };
  const edit = (patch) => {
    setDraft((d) => ({ ...d, ...patch }));
    setPlan(null);
    setProblem(null);
    setSaveNote(null);
  };
  const setPick = (next) => edit({ pick: next });
  const [reading, setReading] = reactExports.useState(false);
  const [readErr, setReadErr] = reactExports.useState(null);
  const [receipt, setReceipt] = reactExports.useState(null);
  const doRead = async () => {
    setReading(true);
    setReadErr(null);
    setReceipt(null);
    const r = await api.composeRead(draft.brief);
    setReading(false);
    if (!isOk(r)) {
      setReadErr(readProblem(r));
      return;
    }
    const { read, dropped, worldwide } = resolveRead(r.value);
    setDraft((d) => {
      const before = { draft: d.pick, names: d.names, classes: d.classes, goods: d.goods, ref: d.ref, deadline: d.deadline };
      const after = applyRead(before, read, own.classes, { worldwide });
      setReceipt({ applied: appliedNotes(before, after, own.classes, levels), doubts: read.notes, dropped });
      const { draft: pick, ...rest } = after;
      return { ...d, ...rest, pick };
    });
    setPlan(null);
    setProblem(null);
    setSaveNote(null);
  };
  const bodyFor = () => ({
    ...names.length > 1 ? { marks: names.map((n) => ({ name: n })) } : { markName: names[0] ?? "" },
    // Only an explicit override travels. Untouched leaves the field off the wire entirely, so the
    // server's ladder resolves it and the review step reports what it actually resolved.
    ...draft.classes && draft.classes.length ? { classes: [...draft.classes] } : {},
    goods: draft.goods.trim(),
    // EXACTLY ONE selector. The engine clarifies when both are set, and it is right to — a saved search
    // already carries a product, so naming one alongside it is a contradiction, not an override.
    ...draft.savedSearch ? { recipeKey: draft.savedSearch } : draft.pick.product ? { product: draft.pick.product } : {},
    ...draft.project ? { projectKey: draft.project } : {},
    // GEOGRAPHY, STATED. The territory list alone could not tell "everywhere" from "I said nothing", and
    // the engine's ladder resolves the second to the account's own territories — so a screen that
    // promised worldwide ran seven countries and no field anywhere disagreed. The stamp says which.
    ...draft.pick.territories.length ? { jurisdictions: [...draft.pick.territories] } : {},
    geography: { mode: geographyFor(draft.pick).mode },
    ...marketplacesApply && parseList(draft.platforms).length ? { platforms: parseList(draft.platforms) } : {},
    // The ONE toggle in the offering, and only TRUE travels: it can add the native-language
    // investigation and can never take one away, so an explicit false would imply a suppression that
    // does not exist. Sent only where the product OFFERS it — on a Full country search it is automatic
    // and the request must not claim to have bought it, and on the other two it is refused.
    //
    // A SAVED SEARCH CARRIES ITS OWN. The toggle is behind the notice while a recipe is selected, so a
    // flag sent from there is one the user cannot see, cannot switch off, and did not choose.
    ...!draft.savedSearch && nativeControl === "toggle" && draft.pick.nativeLanguage ? { nativeLanguage: true } : {},
    ...draft.ref.trim() ? { ref: draft.ref.trim() } : {},
    ...draft.deadline.trim() ? { deadline: draft.deadline.trim() } : {},
    ...draft.instructions.trim() ? { upfrontInstructions: draft.instructions.trim() } : {}
  });
  const explain2 = (r) => {
    switch (r.kind) {
      case "clarify":
        return { title: "A few things need answering first", lines: r.questions };
      case "reject":
      case "collision":
        return { title: "That cannot be searched as written", lines: r.errors };
      case "gate":
        return { title: "The request changed", lines: [r.message] };
      case "rateLimited":
        return { title: "Too many requests just now", lines: ["Wait a moment and try again."] };
      case "pickAccount":
        return { title: "Choose a brand owner", lines: ["Pick who this clearance is for, at the top left."] };
      case "notFound":
        return { title: "That is not available to you", lines: ["Check the brand owner selected at the top left."] };
      // SPLIT FROM `notFound`. They are different answers and only one of them has
      // anything to do with the selector. `notFound` may well BE the wrong brand owner, so that advice is
      // right there. `noAccess` is the door refusing the identity itself — reachable only for door checks,
      // never for anything tenant-scoped — and telling that person to check the selector sends them to the
      // one thing that is not wrong. Someone who signs in successfully and can do nothing should be told
      // why on the page, not in a boot log nobody reads.
      //
      // The words are the ones portal-service already logs at boot: on no staff domain, in no grants row.
      // Nothing here is tenant-scoped, so it leaks nothing the 404-never-403 rule protects — it is a fact
      // about the caller's own identity, and it is the only fact that helps them.
      case "noAccess":
        return {
          title: "This address has no access yet",
          lines: ["You are signed in, but this address is on no staff domain and in no grants row, so every page refuses it. Selecting a different brand owner cannot change that — an administrator needs to add it to one."]
        };
      case "tooLarge":
        return { title: "That is too much to send at once", lines: ["Shorten the goods description, or split the names across two searches."] };
      case "conflict":
        return { title: "That was changed elsewhere", lines: [r.message] };
      case "upstream":
        return { title: "The search was not started", lines: [r.message] };
      default:
        return { title: "Something went wrong", lines: ["Try again shortly."] };
    }
  };
  const doPlan = async () => {
    setBusy(true);
    setProblem(null);
    const r = await api.plan(account, bodyFor());
    setBusy(false);
    if (isOk(r)) {
      setPlan(r.value);
    } else {
      setPlan(null);
      setProblem(explain2(r));
    }
  };
  const doRun = async () => {
    if (!plan) return;
    setBusy(true);
    setProblem(null);
    const r = await api.run(account, { ...bodyFor(), confirmationToken: plan.confirmationToken });
    setBusy(false);
    if (isOk(r)) {
      if (r.value.landedOn) {
        setPlan(null);
        setRunFailure(null);
        ctx.go(`/portal/result/${encodeURIComponent(r.value.landedOn)}`);
        return;
      }
      setSubmitted(r.value.id);
      setPlan(null);
      setRunFailure(null);
    } else {
      setRunFailure(explain2(r));
    }
  };
  const doSave = async () => {
    const label = saveName.trim();
    const slug = editingSlug ?? label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 39);
    if (slug.length < 2) {
      setSaveNote("That name needs at least two letters or numbers in it.");
      return;
    }
    const record = composeSaved({
      label,
      draft: draft.pick,
      classes: draft.classes ?? [],
      platforms: marketplacesApply ? parseList(draft.platforms) : [],
      notes: saveText,
      // A save REPLACES the record, and this screen cannot express everything one may hold (extras, a
      // component with no lever, the retired flag). On an update the previous record is passed so those
      // survive; on a create there is nothing to survive.
      ...editing ? { prior: editing.recipe } : {}
    });
    if (!record) {
      setSaveNote("Pick one of the four searches above first — there is nothing to save yet.");
      return;
    }
    setBusy(true);
    const r = await api.saveSavedSearch(account, slug, "save", {
      recipe: record,
      // Optimistic concurrency, but only where there is a version to name: a create has none, and
      // claiming one would be inventing a fact about a record that does not exist yet.
      ...editing && typeof editing.recipe["version"] === "number" ? { expectedVersion: editing.recipe["version"] } : {}
    });
    setBusy(false);
    if (isOk(r)) {
      if (editingSlug) {
        ctx.go("/portal/brand/searches");
        return;
      }
      setSaveOpen(false);
      setSaveName("");
      setSaveText("");
      const uncommitted = notCommitted(r);
      setSaveNote(uncommitted ? `Saved as “${label}”. ${uncommitted}` : `Saved as “${label}” — it is in your custom searches.`);
    } else if (r.kind === "conflict") {
      setSaveNote("Someone else changed this custom search while you were editing. Reload and re-apply.");
    } else {
      setSaveNote("That could not be saved. Try a different name, or check it on Custom searches.");
    }
  };
  if (submitted) {
    return /* @__PURE__ */ jsxRuntimeExports.jsx(
      Submitted,
      {
        go: ctx.go,
        onAnother: () => {
          setSubmitted(null);
          setDraft(EMPTY);
          setEntry(null);
        }
      }
    );
  }
  if (needsOwner || (searches == null ? void 0 : searches.kind) === "pickAccount") {
    return /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "screen", children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "notice", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("b", { children: "Choose a brand owner first" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("p", { style: { margin: "6px 0 0", color: "var(--text-muted)" }, children: "A clearance is filed for one brand owner. Pick one at the top left, then start the search." })
    ] }) });
  }
  if (!searches) return /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "screen" });
  if (searches.kind !== "ok") return /* @__PURE__ */ jsxRuntimeExports.jsx(OptionsUnavailable, { kind: searches.kind, onRetry: retrySearches });
  const stops = blockers(draft.pick, activeLevel, names.length);
  const overlong = searches.value.maxMarkName == null ? [] : names.filter((n) => n.length > (searches.value.maxMarkName ?? Infinity));
  const markLimit = searches.value.maxMarkName;
  const nameStops = overlong.map((n) => `“${n.slice(0, 30)}…” is ${n.length} characters. A mark name may be at most ${markLimit} — it becomes this run's name and part of every report link, so it cannot carry a description. Put the goods and the description in their own fields below.`);
  const budget = nameBudget(activeLevel, names.length);
  const overBudget = budget != null;
  const exhausted = (usage == null ? void 0 : usage.capped) === true && usage.dailyRuns != null && usage.today >= usage.dailyRuns;
  const missing = !names.length || !classes.length && !draft.goods.trim();
  const ready = !missing && !stops.length && !nameStops.length && !overBudget && !exhausted && activeLevel != null;
  const startedFrom = draft.savedSearch ? (savedRow == null ? void 0 : savedRow.label) ?? "a custom search" : (activeLevel == null ? void 0 : activeLevel.name) ?? "no search picked yet";
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "screen", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "eyebrow", children: editingSlug ? "Custom search" : "New clearance" }),
    /* @__PURE__ */ jsxRuntimeExports.jsx("h1", { style: { fontSize: 27, margin: "4px 0 14px", color: "var(--text-strong)" }, children: editingSlug ? "Edit a custom search" : "New clearance" }),
    editingSlug ? editingRes && editingRes.kind !== "ok" ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "notice", style: { borderColor: "var(--tone-high)" }, children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("b", { children: "That custom search could not be opened" }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { style: { margin: "6px 0 0", color: "var(--text-muted)" }, children: [
        "Nothing has been changed.",
        " ",
        /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "link-btn", onClick: () => ctx.go("/portal/brand/searches"), children: "Back to Custom searches" })
      ] })
    ] }) : editing && !editingPick ? (
      // A record whose product this screen cannot state — `draftFromSaved` refuses rather than
      // approximates, because the nearest thing it CAN say is a different search from the one the
      // client bought. Saying so beats opening a form that would rewrite it on the next Save.
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "notice", style: { borderColor: "var(--tone-medium)" }, children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("b", { children: "This custom search cannot be edited here" }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { style: { margin: "6px 0 0", color: "var(--text-muted)" }, children: [
          "It was built on a search this screen has no setting for, so opening it would change what it does. It still runs exactly as it is. Ask ",
          operatorName(ctx.me.brand),
          " to change it, or build a new one here.",
          " ",
          /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "link-btn", onClick: () => ctx.go("/portal/brand/searches"), children: "Back to Custom searches" })
        ] })
      ] })
    ) : /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "notice quiet", children: /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { style: { margin: 0, color: "var(--text-muted)", fontSize: 13 }, children: [
      "Change the levers below, then ",
      /* @__PURE__ */ jsxRuntimeExports.jsx("b", { children: "Save changes" }),
      " in the footer. Nothing runs, and the searches already run under this one are unaffected — a finished report carries its own set-up."
    ] }) }) : null,
    /* @__PURE__ */ jsxRuntimeExports.jsx(Allowance, { usage }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ctx-card", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }, children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { minWidth: 190, flex: 1 }, children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "field-label", children: "Brand owner" }),
          ctx.me.accounts.length > 1 ? (
            // The same value the sidebar switcher sets — the shell's own filter, mirrored where the
            // decision is being made. It is NEVER a request field: the server stamps identity from the
            // verified sign-in, and a body that named an owner would be a tenancy hole.
            /* @__PURE__ */ jsxRuntimeExports.jsxs(
              "select",
              {
                value: account ?? "",
                onChange: (e) => ctx.setOwner(e.target.value || null),
                className: "ctx-select",
                "aria-label": "Brand owner",
                "data-anon": "mark",
                children: [
                  /* @__PURE__ */ jsxRuntimeExports.jsx("option", { value: "", children: "Choose a brand owner…" }),
                  sortOwners(Object.fromEntries(ctx.me.accounts.map((a) => [a, ctx.ownerName(a)])), ctx.me.accounts).map((o) => /* @__PURE__ */ jsxRuntimeExports.jsx("option", { value: o.key, children: o.name }, o.key))
                ]
              }
            )
          ) : /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { fontSize: 15, fontWeight: 600, color: "var(--text-strong)", padding: "9px 0" }, "data-anon": "mark", children: ownerLabel })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { minWidth: 190, flex: 1 }, children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "field-label", children: "Project" }),
          projects.length ? /* @__PURE__ */ jsxRuntimeExports.jsxs("select", { value: draft.project, onChange: (e) => edit({ project: e.target.value }), className: "ctx-select", "aria-label": "Project", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("option", { value: "", children: "No project" }),
            projects.map((p) => /* @__PURE__ */ jsxRuntimeExports.jsx("option", { value: p.key, children: p.name || p.key }, p.key))
          ] }) : /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { fontSize: 14, color: "var(--text-faint)", padding: "9px 0" }, children: "No project · none configured" })
        ] })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border-hairline)", display: "flex", gap: 26, flexWrap: "wrap" }, children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { minWidth: 230, flex: 1 }, children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }, children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "field-label", style: { marginBottom: 0 }, children: "Classes" }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { fontSize: 11, color: "var(--text-faint)" }, children: draft.classes ? "set for this search" : own.classes.length ? own.classesFrom : "" })
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 9 }, children: !classes.length ? (
            /* AN EMPTY LIST IS NOT "NO CLASSES", AND SAYING SO WOULD BE THE LIE.
               The composer sends no `classes` key when the list is empty, and the scope resolver's
               nonEmpty() collapses undefined, null and [] into one branch — so it hands back the
               brand owner's FULL inherited list. "None set" described the form, not the search that
               would run. Clearing every class is simply not expressible on this wire; rather than
               pretend otherwise, the screen now says what will actually happen. */
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { fontSize: 12.5, color: "var(--tone-medium)" }, children: own.classes.length ? `Cleared — this will search ${own.classesFrom || "the brand owner's classes"} again (${own.classes.join(", ")}). Add one to narrow it.` : "None set — add one, or describe the goods below." })
          ) : classes.map((c) => (
            /* REMOVAL PROMOTES, EXACTLY AS ADDITION ALREADY DID.
               The × used to render only once `draft.classes` was non-null, so while inheriting, every
               chip was inert — no affordance anywhere said a class could be dropped. The capability
               was already there and already correct on the wire: a narrower non-empty list wins at the
               scope resolver. The only way to reach it was to add a class you did not want (which
               promotes the inherited list into an explicit one), delete it, and then delete the ones
               you meant to. Nobody who had not read the source could find that.
               `classes` is already `draft.classes ?? own.classes`, so filtering it promotes and
               removes in one step — the same move the typeahead makes on the first addition. */
            /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: draft.classes ? "chip chip-own" : "chip", children: [
              classLabel(c),
              /* @__PURE__ */ jsxRuntimeExports.jsx(
                "button",
                {
                  type: "button",
                  "aria-label": `Remove class ${c}`,
                  className: "chip-x",
                  onClick: () => edit({ classes: classes.filter((x) => x !== c) }),
                  children: /* @__PURE__ */ jsxRuntimeExports.jsx(Icon, { name: "x", size: 13 })
                }
              )
            ] }, c)
          )) }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "fld-medium", style: { position: "relative" }, children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(
              "input",
              {
                value: classQuery,
                onChange: (e) => setClassQuery(e.target.value),
                placeholder: "Add a class…",
                autoComplete: "off",
                "aria-label": "Add a Nice class",
                className: "ctx-input"
              }
            ),
            classMatches(classQuery, classes).length ? /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "typeahead", children: classMatches(classQuery, classes).map((c) => /* @__PURE__ */ jsxRuntimeExports.jsx(
              "button",
              {
                type: "button",
                onClick: () => {
                  edit({ classes: [...classes, c].filter(isClassNumber).sort((a, b) => a - b) });
                  setClassQuery("");
                },
                children: classLabel(c)
              },
              c
            )) }) : null
          ] }),
          draft.classes ? /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "link-btn", style: { marginTop: 7 }, onClick: () => edit({ classes: null }), children: "Use the brand owner’s classes instead" }) : null
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { minWidth: 230, flex: 1 }, children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }, children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "field-label", style: { marginBottom: 0 }, children: "Marketplaces" }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { style: { fontSize: 11, color: "var(--text-faint)" }, children: [
              own.platforms.length,
              " on file"
            ] })
          ] }),
          marketplacesApply ? own.platforms.length ? /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { display: "flex", flexWrap: "wrap", gap: 6 }, children: [
              (showAllShops ? own.platforms : own.platforms.slice(0, 6)).map((p) => /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "chip chip-mono", "data-anon": "mark", children: p }, p)),
              own.platforms.length > 6 ? /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "chip chip-more", onClick: () => setShowAllShops((v) => !v), children: showAllShops ? "Show less" : `Show all ${own.platforms.length}` }) : null
            ] }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("p", { style: { margin: "9px 0 0", fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.5 }, children: "Every marketplace listed here is a forced deep dive inherited from Brand Owner and then Project configuration. By default common law sweeps everything it can find on the open web, but this ensures particular focus to important markets." }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { marginTop: 10 }, children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "field-label", children: "Add more for this search" }),
              /* @__PURE__ */ jsxRuntimeExports.jsx(
                "input",
                {
                  value: draft.platforms,
                  onChange: (e) => edit({ platforms: e.target.value }),
                  placeholder: "gnc.com, iherb.com",
                  "aria-label": "Extra marketplaces for this search",
                  className: "ctx-input"
                }
              ),
              /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { style: { margin: "6px 0 0", fontSize: 11.5, color: "var(--text-faint)", lineHeight: 1.45 }, children: [
                "To edit the default list see",
                " ",
                /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "link-btn", onClick: () => ctx.go("/portal/brand/profile"), children: "Brand profile" }),
                "."
              ] })
            ] })
          ] }) : /* @__PURE__ */ jsxRuntimeExports.jsx("p", { style: { margin: 0, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }, children: "None on file — the open web is searched regardless. Add shops on Brand profile, or name extra ones for this search below." }) : /* @__PURE__ */ jsxRuntimeExports.jsx("p", { style: { margin: 0, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }, children: activePipeline === "knockout" ? "A knockout search sweeps these shops and the open web as one broad question per name. The structured grid — every shop checked term by term, with a coverage ledger — runs on a clearance." : "These shops are swept on every search we run." })
        ] })
      ] })
    ] }),
    entry === null ? /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "entry-grid", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("button", { type: "button", className: "entry-card", onClick: () => setEntry("describe"), children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "entry-title", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(Icon, { name: "sparkles", size: 17 }),
            "Describe it"
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "entry-body", children: "Type it, or paste the email you were sent — it is read for you and this form fills in. Every field stays editable." })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("button", { type: "button", className: "entry-card", onClick: () => setEntry("manual"), children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "entry-title", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(Icon, { name: "sliders", size: 17 }),
            "Set it up myself"
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "entry-body", children: "Choose the names, where to look, and how deep." })
        ] })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { marginTop: 18 }, children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "field-label", children: "Or start from one of the four searches" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { display: "flex", flexWrap: "wrap", gap: 8 }, children: levels.map((t) => /* @__PURE__ */ jsxRuntimeExports.jsx(
          "button",
          {
            type: "button",
            className: "start-pill",
            onClick: () => {
              edit({ pick: chooseProduct(draft.pick, t), savedSearch: "" });
              setEntry("manual");
            },
            children: t.name
          },
          t.key
        )) }),
        savedSearches.length ? /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "field-label", style: { margin: "16px 0 6px" }, children: [
            "Custom searches",
            " ",
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { textTransform: "none", letterSpacing: 0, fontWeight: 500 }, children: "· start from one you built" })
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { display: "flex", flexWrap: "wrap", gap: 8 }, children: savedSearches.map((r) => /* @__PURE__ */ jsxRuntimeExports.jsx(
            "button",
            {
              type: "button",
              className: "start-pill start-pill-saved",
              "data-anon": "mark",
              onClick: () => {
                edit({ savedSearch: r.slug });
                setEntry("manual");
              },
              children: r.label
            },
            r.slug
          )) })
        ] }) : null
      ] })
    ] }) : /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "segmented-entry", role: "group", "aria-label": "How to set this up", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", "aria-pressed": entry === "describe", onClick: () => setEntry("describe"), children: "Describe it" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", "aria-pressed": entry === "manual", onClick: () => setEntry("manual"), children: "Set it up myself" })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "composer-col", children: [
        entry === "describe" ? /* @__PURE__ */ jsxRuntimeExports.jsx(
          DescribeIt,
          {
            value: draft.brief,
            onChange: (brief) => edit({ brief }),
            can: readCan,
            reading,
            error: readErr,
            receipt,
            onRead: () => {
              void doRead();
            }
          }
        ) : null,
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "section-title", children: "Names" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "section-hint", children: activeLevel && activeLevel.maxNames > 1 ? `One per line — a ${activeLevel.name} reads up to ${activeLevel.maxNames}.` : "One name — a clearance reads one at a time." }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(
            "textarea",
            {
              value: draft.names,
              onChange: (e) => edit({ names: e.target.value }),
              placeholder: "AQUAPLUS",
              "aria-label": "Names",
              "data-anon": "mark",
              className: "names-box"
            }
          ),
          budget ? /* @__PURE__ */ jsxRuntimeExports.jsx(
            NameWall,
            {
              count: names.length,
              allowed: budget.allowed,
              first: names[0] ?? "",
              canScreen: !draft.savedSearch && knockout != null,
              screenName: (knockout == null ? void 0 : knockout.name) ?? "Knockout search",
              onScreenAll: () => {
                if (knockout) edit({ pick: chooseProduct(draft.pick, knockout) });
              }
            }
          ) : names.length > 1 ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { fontSize: 12.5, color: "var(--text-muted)", marginTop: 7 }, children: [
            names.length,
            " names, one search."
          ] }) : null
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { display: "flex", alignItems: "baseline", gap: 9, marginBottom: 4 }, children: /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "section-title", style: { marginBottom: 0 }, children: "Which search" }) }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { display: "flex", flexDirection: "column", gap: 8 }, children: levels.map((t) => /* @__PURE__ */ jsxRuntimeExports.jsx(
            PickRow,
            {
              selected: !draft.savedSearch && draft.pick.product === t.key,
              unavailableNote: t.available ? null : t.unavailableNote ?? "Not available just now.",
              coverageNote: t.available ? t.coverageNote : null,
              capabilityNote: t.available ? t.capabilityNote : null,
              onPick: () => edit({ pick: chooseProduct(draft.pick, t), savedSearch: "" }),
              title: t.name,
              tagline: `${t.geography} · up to ${t.maxNames} name${t.maxNames === 1 ? "" : "s"}${t.baseTurnaround ? ` · from ${t.baseTurnaround}` : ""}`,
              description: [
                // — THE COUNTS ARE PART OF WHAT A KNOCKOUT IS, so the card says so. This row
                // read "No register search", which was true of a tier the offering retired and
                // false of the one it sells: every Knockout takes register filing counts. A client
                // choosing between the four searches was being told this one does not touch a
                // register, and then receiving a report whose second section is register figures.
                t.pipeline === "knockout" ? "Marketplace and common-law screen across many names at once, plus register filing counts for every name — identical, containing and close variations of it — scoped to the classes you name." : "Trademark registers and the live marketplace, one name.",
                t.caseLaw ? "Reasoned against the case law and oppositions of that country." : "",
                t.nativeLanguage === "automatic" ? "The native language of that country is searched automatically." : "",
                t.nativeLanguage === "offered" ? "The native-language investigation is optional here." : ""
              ].filter(Boolean).join(" ")
            },
            t.key
          )) }),
          savedSearches.length ? /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "field-label", style: { margin: "16px 0 8px" }, children: [
              "Custom searches",
              " ",
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { textTransform: "none", letterSpacing: 0, fontWeight: 500 }, children: "· reuse one you built" })
            ] }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "saved-list", children: savedSearches.map((r) => /* @__PURE__ */ jsxRuntimeExports.jsxs(
              "div",
              {
                className: draft.savedSearch === r.slug ? "saved-row saved-row-on" : "saved-row",
                onClick: () => edit({ savedSearch: r.slug }),
                role: "button",
                tabIndex: 0,
                "aria-pressed": draft.savedSearch === r.slug,
                onKeyDown: (e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    edit({ savedSearch: r.slug });
                  }
                },
                children: [
                  /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: draft.savedSearch === r.slug ? "radio radio-on" : "radio", "aria-hidden": true }),
                  /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { style: { flex: 1, minWidth: 0 }, children: [
                    /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { fontSize: 13.5, fontWeight: 600, color: "var(--text-strong)" }, "data-anon": "mark", children: r.label }),
                    /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { fontSize: 11.5, color: "var(--text-faint)", marginLeft: 8 }, children: (() => {
                      const l = levels.find((x) => x.key === r.base);
                      return l ? l.name || l.stageLabel : "no longer available";
                    })() })
                  ] }),
                  /* @__PURE__ */ jsxRuntimeExports.jsx(
                    "button",
                    {
                      type: "button",
                      title: "Retire this custom search",
                      "aria-label": `Retire ${r.label}`,
                      className: "saved-retire",
                      onClick: (e) => {
                        e.stopPropagation();
                        ctx.go("/portal/brand/searches");
                      },
                      children: /* @__PURE__ */ jsxRuntimeExports.jsx(Icon, { name: "trash", size: 15 })
                    }
                  )
                ]
              },
              r.slug
            )) })
          ] }) : null
        ] }),
        draft.savedSearch ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "notice", style: { margin: 0 }, children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("b", { children: "This custom search carries its own set-up" }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { style: { margin: "6px 0 0", color: "var(--text-muted)" }, children: [
            "It decides how deep the search goes. Where, below, is still yours to set — the custom search does not fix it.",
            " ",
            /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "link-btn", onClick: () => edit({ savedSearch: "" }), children: "Set the levers myself instead" })
          ] })
        ] }) : /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { display: "flex", alignItems: "baseline", gap: 9, marginBottom: 3 }, children: /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "section-title", style: { marginBottom: 0 }, children: "What this search includes" }) }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("ul", { className: "carries", children: [
              { in: true, text: `Trademark registers — ${activePipeline === "knockout" ? "filing counts per name (identical · containing · close variations), scoped to your classes; the filings themselves are not analysed" : "searched, across your classes"}` },
              { in: true, text: `Marketplace & common-law use — ${activePipeline === "knockout" ? "one broad sweep per name" : "the full grid, every shop term by term"}` },
              { in: Boolean(activeLevel == null ? void 0 : activeLevel.caseLaw), text: `Case law and oppositions — ${(activeLevel == null ? void 0 : activeLevel.caseLaw) ? "part of this search" : "not part of this search"}` }
            ].map((row) => /* @__PURE__ */ jsxRuntimeExports.jsx(Carries, { included: row.in, label: row.text, children: row.text }, row.text)) }),
            nativeControl === "toggle" ? /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "sunken-block", style: { marginTop: 12 }, children: /* @__PURE__ */ jsxRuntimeExports.jsx(
              Lever,
              {
                label: "Native-language investigation",
                hint: "Native marketplaces and native registers in the language of the countries you named. A clearance already searches the mark transliterated into the scripts its territories register marks in — this is the deeper read.",
                on: draft.pick.nativeLanguage,
                onToggle: () => setPick(toggleNativeLanguage(draft.pick, activeLevel))
              }
            ) }) : nativeControl === "automatic" ? /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "section-hint", style: { marginTop: 10 }, children: "The native language of that country is searched automatically — it is part of this search, not something to switch on." }) : null
          ] }),
          levels.length ? (
            /* No margin of its own any more. As a child of the wrapper it needed one; as a direct
               child of `.composer-col` it inherits the column's 26px flex gap, and keeping the 14
               on top put it 40px from the list it belongs to — further than two SECTIONS sit
               apart, which reads as detached rather than as part of what is above it. */
            /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "composer-wide", children: /* @__PURE__ */ jsxRuntimeExports.jsx(Details, { summary: "Detailed search comparison table for information", children: /* @__PURE__ */ jsxRuntimeExports.jsx(ProductMatrix, { products: levels, currentKey: activeBase }) }) })
          ) : null
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "section-title", children: "Where" }),
          geoNote ? /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "section-hint", children: geoNote }) : null,
          (activeLevel == null ? void 0 : activeLevel.geography) === "worldwide, and nothing else" ? (
            // NO PICKER AT ALL, and that is the design. Worldwide is not a choice on this search —
            // it IS this search — so a territory field here would be a control whose every use is
            // refused. The chip states the fact; the sentence above says why there is nothing to set.
            /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { display: "flex", flexWrap: "wrap", gap: 6, margin: "9px 0 0" }, children: /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "chip", children: "Worldwide" }) })
          ) : /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { display: "flex", flexWrap: "wrap", gap: 6, margin: "9px 0 10px" }, children: draft.pick.territories.length === 0 ? own.territories.length ? /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
              own.territories.map((t) => /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "chip", "data-anon": "mark", children: t }, t)),
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { fontSize: 11, color: "var(--text-faint)", alignSelf: "center" }, children: own.territoriesFrom })
            ] }) : /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "chip", children: "Worldwide" }) : draft.pick.territories.map((t) => (
              /* — a chosen territory the register cannot reach keeps its
                 chip and says so. It is ordered, and disclosed as deferred coverage rather than
                 searched; removing it from the list would be the silent narrowing this issue is
                 about, one step later. */
              /* @__PURE__ */ jsxRuntimeExports.jsxs(
                "span",
                {
                  className: reachesTerritory(t, registerTerritories) ? "chip chip-own" : "chip chip-own chip-deferred",
                  title: reachesTerritory(t, registerTerritories) ? void 0 : "The register wired to this deployment does not reach this territory — it is disclosed in the report as deferred coverage rather than searched.",
                  children: [
                    t,
                    reachesTerritory(t, registerTerritories) ? "" : " · register deferred",
                    /* @__PURE__ */ jsxRuntimeExports.jsx(
                      "button",
                      {
                        type: "button",
                        "aria-label": `Remove ${t}`,
                        className: "chip-x",
                        onClick: () => setPick(removeTerritory(draft.pick, t)),
                        children: /* @__PURE__ */ jsxRuntimeExports.jsx(Icon, { name: "x", size: 13 })
                      }
                    )
                  ]
                },
                t
              )
            )) }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "fld-medium", style: { position: "relative" }, children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx(
                "input",
                {
                  value: territoryQuery,
                  onChange: (e) => setTerritoryQuery(e.target.value),
                  placeholder: (activeLevel == null ? void 0 : activeLevel.geography) === "exactly one country" ? "Type a country…" : "Type a country or region…",
                  autoComplete: "off",
                  "aria-label": "Add a territory",
                  className: "ctx-input",
                  disabled: !activeLevel
                }
              ),
              territoryMatches(territoryQuery, draft.pick.territories, activeLevel, 8).length ? /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "typeahead", children: territoryMatches(territoryQuery, draft.pick.territories, activeLevel, 8).map((t) => /* @__PURE__ */ jsxRuntimeExports.jsxs(
                "button",
                {
                  type: "button",
                  onClick: () => {
                    setPick(addTerritory(draft.pick, t, activeLevel));
                    setTerritoryQuery("");
                  },
                  children: [
                    t,
                    reachesTerritory(t, registerTerritories) ? null : /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "typeahead-note", children: "register deferred" })
                  ]
                },
                t
              )) }) : null
            ] }),
            Array.isArray(registerTerritories) ? (
              // BOTH FIGURES ARE SCOPED TO THE PRODUCT, which is what `registerTerritories.length`
              // alone would get wrong: a Full country search can name no regions, so a region the
              // register covers is not one of "the territories you can name here".
              /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { className: "section-hint", style: { marginTop: 10 }, children: [
                "The trademark register wired to this deployment reaches",
                " ",
                vocabularyFor(activeLevel, registerTerritories).length,
                " of the",
                " ",
                offerableFor(activeLevel).length,
                " territories you can name here:",
                " ",
                vocabularyFor(activeLevel, registerTerritories).join(", "),
                ". Anywhere else can still be ordered — it is disclosed in the report as deferred coverage rather than searched at the register."
              ] })
            ) : null,
            (activeLevel == null ? void 0 : activeLevel.geography) === "exactly one country" && draft.pick.territories.length === 1 ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "callout-accent", children: [
              draft.pick.territories[0],
              " — naming another country replaces it, because this search reads one at a time."
            ] }) : null
          ] })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "section-title", children: "Goods or services description (optional)" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(
            "textarea",
            {
              value: draft.goods,
              onChange: (e) => edit({ goods: e.target.value }),
              rows: 3,
              "aria-label": "Goods or services",
              placeholder: "Downloadable software for fleet logistics; software as a service.",
              className: "ctx-input",
              style: { resize: "vertical", lineHeight: 1.5 }
            }
          )
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "section-title", children: "Any context that might be relevant (optional)." }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(
            "textarea",
            {
              value: draft.instructions,
              onChange: (e) => edit({ instructions: e.target.value }),
              rows: 3,
              "aria-label": "Any context that might be relevant",
              placeholder: "Example: we already own the mark in the US and this is about the EU launch. Our launch page is https://example.com/press/aquaplus-launch, and there is a LinkedIn post announcing it from 3 June.",
              className: "ctx-input",
              style: { resize: "vertical", lineHeight: 1.5 }
            }
          ),
          /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "section-hint", style: { margin: "7px 0 0" }, children: "A search started by an agent through the connector can reference emails or documents it can already read, so there is nothing to paste in that case." })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs(Details, { summary: "References and dates (optional)", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(Field$1, { label: "Your reference", hint: "Appears in report and file name", children: /* @__PURE__ */ jsxRuntimeExports.jsx("input", { value: draft.ref, onChange: (e) => edit({ ref: e.target.value }), placeholder: "TMP1234", className: "ctx-input" }) }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(Field$1, { label: "Deadline", hint: "Date may have a bearing on report synthesis", children: /* @__PURE__ */ jsxRuntimeExports.jsx(
            "input",
            {
              type: "date",
              value: draft.deadline,
              onChange: (e) => edit({ deadline: e.target.value }),
              className: "ctx-input fld-narrow"
            }
          ) })
        ] }),
        stops.length || nameStops.length ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "notice", style: { borderColor: "var(--tone-medium)", margin: 0 }, children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("b", { children: "Not runnable as set" }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("ul", { style: { margin: "8px 0 0", paddingLeft: 18, color: "var(--text-muted)" }, children: [
            nameStops.map((s, i) => /* @__PURE__ */ jsxRuntimeExports.jsx("li", { style: { marginBottom: 3 }, children: s }, `n${i}`)),
            stops.map((s, i) => /* @__PURE__ */ jsxRuntimeExports.jsx("li", { style: { marginBottom: 3 }, children: s }, i))
          ] })
        ] }) : null,
        problem ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "notice", style: { borderColor: "var(--tone-high)", margin: 0 }, children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("b", { children: problem.title }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("ul", { style: { margin: "8px 0 0", paddingLeft: 18, color: "var(--text-muted)" }, children: problem.lines.map((l, i) => /* @__PURE__ */ jsxRuntimeExports.jsx("li", { style: { marginBottom: 3 }, children: l }, i)) })
        ] }) : null
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsx(
        Footer,
        {
          startedFrom,
          tier: (activeLevel == null ? void 0 : activeLevel.name) || (activeLevel == null ? void 0 : activeLevel.stageLabel) || (draft.savedSearch ? "Custom search" : "No search picked"),
          detail: [
            names.length ? `${names.length} name${names.length === 1 ? "" : "s"}` : "no names yet",
            // Same correction as the Where chips: unset resolves to the account's territories, not to
            // the world. The footer is the running total someone watches while composing, so it is the
            // last place that should disagree with what will actually run.
            draft.pick.territories.length ? draft.pick.territories.join(", ") : own.territories.length ? own.territories.join(", ") : "worldwide",
            checksSummary(effort)
          ].join(" · "),
          units: ((_b = plan == null ? void 0 : plan.effort) == null ? void 0 : _b.units) ?? effortUnits(effort),
          cost: ((_c = plan == null ? void 0 : plan.effort) == null ? void 0 : _c.costBand) ?? costBand(effort),
          duration: ((_d = plan == null ? void 0 : plan.effort) == null ? void 0 : _d.turnaround) || turnaround(effort),
          runs: runsNote(effort),
          ready,
          busy,
          demoMode: ctx.me.engineMode === "demo",
          saveOpen,
          saveName,
          saveText,
          saveNote,
          editing: editingSlug != null,
          canSave: !draft.savedSearch && !stops.length,
          onSaveOpen: () => {
            setSaveOpen(true);
            setSaveName(activeLevel ? `${activeLevel.name}` : "Custom search");
          },
          onSaveName: setSaveName,
          onSaveText: setSaveText,
          onSaveCancel: () => {
            if (editingSlug) {
              ctx.go("/portal/brand/searches");
              return;
            }
            setSaveOpen(false);
            setSaveNote(null);
          },
          onSave: doSave,
          onReview: doPlan
        }
      ),
      plan ? /* @__PURE__ */ jsxRuntimeExports.jsx(
        ReviewDialog,
        {
          plan,
          busy,
          owner: ownerLabel,
          project: projectLabel,
          names,
          onStart: doRun,
          onBack: () => {
            setPlan(null);
            setRunFailure(null);
          },
          failure: runFailure,
          onReview: () => {
            setPlan(null);
            setRunFailure(null);
            void doPlan();
          }
        }
      ) : null
    ] })
  ] });
}
function DescribeIt({ value, onChange, can, reading, error, receipt, onRead }) {
  const tooLong = value.length > can.maxBrief;
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { paddingBottom: 22, borderBottom: "1px solid var(--border-hairline)" }, children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx("p", { style: { margin: "0 0 8px", fontSize: 12.5, color: "var(--text-muted)" }, children: "A sentence is enough, or paste the whole thread." }),
    /* @__PURE__ */ jsxRuntimeExports.jsx(
      "textarea",
      {
        value,
        onChange: (e) => onChange(e.target.value),
        rows: 4,
        "aria-label": "Describe the search",
        "data-anon": "mark",
        placeholder: "Need a quick check on AQUAPLUS for energy drinks in the US before Friday — just the obvious blockers.",
        className: "ctx-input",
        style: { resize: "vertical", lineHeight: 1.5 }
      }
    ),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { display: "flex", gap: 9, marginTop: 10, alignItems: "center", flexWrap: "wrap" }, children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs(
        "button",
        {
          type: "button",
          className: "btn-primary",
          disabled: !can.available || reading || value.trim() === "" || tooLong,
          onClick: onRead,
          title: can.available ? void 0 : can.note ?? void 0,
          children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(Icon, { name: "sparkles", size: 14 }),
            reading ? "Reading…" : "Fill it in for me"
          ]
        }
      ),
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "fld-wide", style: { fontSize: 12.5, color: "var(--text-muted)" }, children: !can.available ? can.note ?? "Reading a brief is not switched on here yet — set the search up below." : tooLong ? `That is ${value.length.toLocaleString("en-GB")} characters — paste up to ${can.maxBrief.toLocaleString("en-GB")}, or set the search up below.` : "Sets the search up below, ready to edit." })
    ] }),
    error ? /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "callout-accent", style: { marginTop: 12 }, children: error }) : null,
    receipt ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "read-receipt", style: { marginTop: 12 }, children: [
      receipt.applied.length > 0 ? /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "read-receipt-head", children: "What I read" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("ul", { children: receipt.applied.map((n) => /* @__PURE__ */ jsxRuntimeExports.jsx("li", { children: n }, n)) })
      ] }) : (
        // A read that changed nothing says so. The alternative — an empty box under a pressed
        // button — reads as a failure the user cannot see or retry deliberately.
        /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "read-receipt-head", children: "Nothing in that I could turn into a search — set it up below." })
      ),
      receipt.doubts.length > 0 ? /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "read-receipt-head", style: { marginTop: 10 }, children: "Not sure about" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("ul", { children: receipt.doubts.map((n) => /* @__PURE__ */ jsxRuntimeExports.jsx("li", { children: n }, n)) })
      ] }) : null,
      receipt.dropped.length > 0 ? /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "read-receipt-head", style: { marginTop: 10 }, children: "Left out — not a territory this search offers" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("ul", { children: receipt.dropped.map((n) => /* @__PURE__ */ jsxRuntimeExports.jsx("li", { children: n }, n)) })
      ] }) : null
    ] }) : null
  ] });
}
function NameWall({
  count: count2,
  allowed,
  first,
  canScreen,
  screenName,
  onScreenAll
}) {
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "callout-accent", style: { marginTop: 11 }, children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
      allowed === 1 ? `A clearance reads one name at a time — you have ${count2}.` : `This search takes ${allowed} names — you have ${count2}.`,
      canScreen ? ` Screen them all together on a ${screenName}, or clear the first one now.` : ""
    ] }),
    canScreen ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { marginTop: 9, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }, children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("button", { type: "button", className: "btn-ghost", onClick: onScreenAll, children: [
        "Screen all ",
        count2,
        " together"
      ] }),
      first ? /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { style: { fontSize: 12, color: "var(--text-muted)" }, "data-anon": "mark", children: [
        "or leave ",
        first,
        " on its own"
      ] }) : null
    ] }) : null
  ] });
}
function Footer({
  startedFrom,
  tier,
  detail,
  units,
  cost,
  duration,
  runs,
  ready,
  busy,
  demoMode,
  saveOpen,
  saveName,
  saveText,
  saveNote,
  editing,
  canSave,
  onSaveOpen,
  onSaveName,
  onSaveText,
  onSaveCancel,
  onSave,
  onReview
}) {
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "composer-footer", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { minWidth: 210, flex: 1 }, children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "footer-eyebrow", children: [
        "Starting from · ",
        startedFrom
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginTop: 3 }, children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { fontSize: 16, fontWeight: 700, letterSpacing: "-.01em", color: "var(--text-strong)" }, children: tier }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { fontSize: 12, color: "var(--text-muted)" }, children: detail })
      ] }),
      runs ? /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { fontSize: 12, color: "var(--text-muted)", marginTop: 3 }, children: runs }) : null,
      saveNote ? /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { fontSize: 12, color: "var(--text-accent)", marginTop: 3 }, children: saveNote }) : null
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }, children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { minWidth: 104 }, children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { display: "flex", gap: 2, marginBottom: 4 }, "aria-hidden": true, children: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: i <= units ? "bar bar-on" : "bar" }, i)) }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "footer-eyebrow", children: [
          "Effort ",
          units,
          "/10"
        ] })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { fontSize: 13.5, fontWeight: 700, color: "var(--text-strong)" }, children: duration }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "footer-eyebrow", children: "turnaround" })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { display: "inline-flex", gap: 3 }, "aria-hidden": true, children: [1, 2, 3, 4, 5].map((i) => /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: i <= cost ? "dot dot-on" : "dot" }, i)) }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "footer-eyebrow", style: { marginTop: 3 }, children: "cost" })
      ] })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { display: "flex", alignItems: "center", gap: 9, flex: "none", flexWrap: "wrap" }, children: [
      canSave && !saveOpen ? /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "btn-ghost", onClick: onSaveOpen, children: "Save as search" }) : null,
      canSave && saveOpen ? /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { style: { display: "inline-flex", alignItems: "center", gap: 7 }, children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(
          "input",
          {
            value: saveName,
            onChange: (e) => onSaveName(e.target.value),
            placeholder: "Name this search",
            "aria-label": "Name this search",
            className: "ctx-input",
            "data-anon": "mark",
            style: { width: 160, fontSize: 12.5, padding: "8px 10px" }
          }
        ),
        /* @__PURE__ */ jsxRuntimeExports.jsx(
          "input",
          {
            value: saveText,
            onChange: (e) => onSaveText(e.target.value),
            placeholder: "Note (optional)",
            "aria-label": "Note about this custom search",
            className: "ctx-input",
            "data-anon": "mark",
            style: { width: 150, fontSize: 12.5, padding: "8px 10px" }
          }
        ),
        /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "btn-primary", style: { padding: "8px 12px", fontSize: 12.5 }, disabled: busy, onClick: onSave, children: editing ? "Save changes" : "Save" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "btn-ghost", style: { padding: "8px 10px" }, onClick: onSaveCancel, "aria-label": editing ? "Stop editing" : "Cancel saving", children: "×" })
      ] }) : null,
      demoMode ? (
        // NO DEAD BUTTON. Before this the button was live, the click was accepted, and the
        // refusal arrived as a 502 several seconds later — a user cannot tell that from a broken
        // product. The sentence says where they are and the one command that moves them, which is
        // the difference between "you are missing four things" and "you are here".
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "footer-demo-note", role: "status", style: { fontSize: 12.5, lineHeight: 1.45 }, children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("strong", { children: "No search engine is attached to this install." }),
          " ",
          "Everything else works — the example report, its audit trail and the assistant connection are live right now. To start new searches, install a reasoning CLI and sign in, then run",
          " ",
          /* @__PURE__ */ jsxRuntimeExports.jsx("code", { children: "npm run setup" }),
          " again."
        ] })
      ) : /* @__PURE__ */ jsxRuntimeExports.jsxs("button", { type: "button", className: "btn-primary", disabled: !ready || busy, onClick: onReview, children: [
        busy ? "Checking…" : "Review clearance",
        /* @__PURE__ */ jsxRuntimeExports.jsx(Icon, { name: "arrow-right", size: 14 })
      ] })
    ] })
  ] });
}
function Lever({
  label,
  hint,
  on,
  onToggle,
  coming
}) {
  return /* @__PURE__ */ jsxRuntimeExports.jsxs(
    "button",
    {
      type: "button",
      onClick: coming ? void 0 : onToggle,
      disabled: coming,
      "aria-pressed": on,
      className: `lever${on ? " lever-on" : ""}${coming ? " lever-coming" : ""}`,
      children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: on ? "lever-box lever-box-on" : "lever-box", "aria-hidden": true }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { style: { minWidth: 0, flex: 1 }, children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { display: "block", fontSize: 13, fontWeight: 600, color: "var(--text-strong)" }, children: label }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { display: "block", fontSize: 11.5, color: "var(--text-faint)", lineHeight: 1.4 }, children: hint })
        ] }),
        coming ? /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "coming", children: "Coming" }) : null
      ]
    }
  );
}
function Carries({ included, label, children }) {
  return (
    // The claim in words on the ROW, the glyph hidden — the same convention the comparison table below
    // uses for its markers, rather than a visually-hidden span this stylesheet does not have.
    /* @__PURE__ */ jsxRuntimeExports.jsxs("li", { className: included ? "carries-in" : "carries-out", "aria-label": `${included ? "Included" : "Not included"}: ${label}`, children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "carries-mark", "aria-hidden": true, children: included ? "✓" : "✕" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { "aria-hidden": true, children })
    ] })
  );
}
function PickRow({
  selected,
  onPick,
  title,
  tagline,
  description,
  unavailableNote = null,
  coverageNote = null,
  capabilityNote = null
}) {
  const off = unavailableNote != null;
  return /* @__PURE__ */ jsxRuntimeExports.jsxs(
    "button",
    {
      type: "button",
      onClick: off ? void 0 : onPick,
      disabled: off,
      "aria-pressed": selected,
      "aria-describedby": void 0,
      className: `pick-row${selected ? " pick-row-on" : ""}${off ? " pick-row-off" : ""}`,
      children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: selected ? "radio radio-on" : "radio", style: { marginTop: 2 }, "aria-hidden": true }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { style: { minWidth: 0 }, children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { style: { display: "flex", alignItems: "baseline", gap: 9, flexWrap: "wrap" }, children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { fontSize: 14, fontWeight: 700, color: "var(--text-strong)" }, children: title }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { fontFamily: "var(--font-mono)", fontSize: 10.5, letterSpacing: ".03em", color: "var(--accent-quiet)" }, children: tagline })
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { display: "block", fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5, marginTop: 2 }, children: description }),
          off ? /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "pick-row-why", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("b", { children: "Not available here" }),
            " — ",
            unavailableNote
          ] }) : null,
          !off && coverageNote ? /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "pick-row-coverage", children: coverageNote }) : null,
          !off && capabilityNote ? /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "pick-row-capability", children: capabilityNote }) : null
        ] })
      ]
    }
  );
}
function ReviewDialog({
  plan,
  busy,
  owner,
  project,
  names,
  onStart,
  onBack,
  failure,
  onReview
}) {
  var _a, _b;
  reactExports.useEffect(() => {
    const on = (e) => {
      if (e.key === "Escape") onBack();
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [onBack]);
  const scope = plan.scope;
  return /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "modal-scrim", onClick: onBack, role: "dialog", "aria-modal": "true", "aria-label": "Review before you start", children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "modal-card", onClick: (e) => e.stopPropagation(), children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "modal-head", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "modal-rule", "aria-hidden": true }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "eyebrow", style: { color: "var(--accent-quiet)" }, children: "Review before you start" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("h2", { style: { margin: "7px 0 3px", fontSize: 21, fontWeight: 700, letterSpacing: "-.02em", color: "var(--text-strong)" }, children: plan.name || plan.stageLabel }),
      plan.stageLabel && plan.stageLabel !== (plan.name || plan.stageLabel) ? /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { fontSize: 12.5, color: "var(--text-faint)", marginBottom: 3 }, children: plan.stageLabel }) : null,
      /* @__PURE__ */ jsxRuntimeExports.jsx("p", { style: { margin: 0, fontSize: 12.5, color: "var(--text-muted)" }, children: "Search configuration" })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { padding: "6px 24px" }, children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx(Row$3, { label: "Brand owner", children: /* @__PURE__ */ jsxRuntimeExports.jsx("span", { "data-anon": "mark", children: owner }) }),
      /* @__PURE__ */ jsxRuntimeExports.jsx(Row$3, { label: "Project", children: project ?? "No project" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx(Row$3, { label: "Names", children: /* @__PURE__ */ jsxRuntimeExports.jsx("span", { "data-anon": "mark", children: names.join(", ") || String(plan.marks) }) }),
      scope && scope.jurisdictions.length ? /* @__PURE__ */ jsxRuntimeExports.jsxs(Row$3, { label: "Where", children: [
        scope.jurisdictions.join(", "),
        " ",
        /* @__PURE__ */ jsxRuntimeExports.jsxs(Muted, { children: [
          "— from ",
          scope.jurisdictionsFrom
        ] })
      ] }) : /* @__PURE__ */ jsxRuntimeExports.jsx(Row$3, { label: "Where", children: "Worldwide" }),
      plan.coverage ? /* @__PURE__ */ jsxRuntimeExports.jsxs(Row$3, { label: "Register reach", children: [
        plan.coverage.reached.length,
        " of ",
        plan.coverage.reached.length + plan.coverage.missing.length,
        " ",
        "territories: ",
        plan.coverage.reached.join(", "),
        ".",
        " ",
        /* @__PURE__ */ jsxRuntimeExports.jsx(Muted, { children: "The rest are disclosed in the report as deferred coverage rather than searched at the register." })
      ] }) : null,
      scope && scope.classes.length ? /* @__PURE__ */ jsxRuntimeExports.jsxs(Row$3, { label: "Classes", children: [
        scope.classes.join(", "),
        " ",
        /* @__PURE__ */ jsxRuntimeExports.jsxs(Muted, { children: [
          "— from ",
          scope.classesFrom
        ] })
      ] }) : null,
      scope && scope.platforms.length ? /* @__PURE__ */ jsxRuntimeExports.jsxs(Row$3, { label: "Marketplaces", children: [
        scope.platforms.length,
        " shop",
        scope.platforms.length === 1 ? "" : "s",
        scope.platformsAdded.length ? /* @__PURE__ */ jsxRuntimeExports.jsxs(Muted, { children: [
          " (",
          scope.platformsAdded.join(", "),
          " added for this search)"
        ] }) : null
      ] }) : null,
      ((_a = plan.effort) == null ? void 0 : _a.turnaround) || plan.turnaround ? /* @__PURE__ */ jsxRuntimeExports.jsx(Row$3, { label: "Turnaround", children: ((_b = plan.effort) == null ? void 0 : _b.turnaround) || plan.turnaround }) : null,
      plan.effort ? /* @__PURE__ */ jsxRuntimeExports.jsx(Row$3, { label: "Effort", children: /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { style: { display: "inline-flex", alignItems: "center", gap: 10, flexWrap: "wrap" }, children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { display: "inline-flex", gap: 2 }, "aria-hidden": true, children: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: i <= plan.effort.units ? "bar bar-on" : "bar" }, i)) }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs(Muted, { children: [
          plan.effort.units,
          "/10 for this brand owner"
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { display: "inline-flex", gap: 3 }, "aria-hidden": true, children: [1, 2, 3, 4, 5].map((i) => /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: i <= plan.effort.costBand ? "dot dot-on" : "dot" }, i)) }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(Muted, { children: "cost" })
      ] }) }) : null,
      plan.warnings.length ? /* @__PURE__ */ jsxRuntimeExports.jsx("ul", { style: { margin: "12px 0 0", paddingLeft: 18, color: "var(--text-muted)", fontSize: 13 }, children: plan.warnings.map((w, i) => /* @__PURE__ */ jsxRuntimeExports.jsx("li", { style: { marginBottom: 3 }, children: w }, i)) }) : null,
      plan.caveat ? /* @__PURE__ */ jsxRuntimeExports.jsx("p", { style: { margin: "12px 0 0", fontSize: 12.5, color: "var(--text-muted)", fontStyle: "italic" }, children: plan.caveat }) : null,
      failure ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "notice", style: { borderColor: "var(--tone-high)", margin: "14px 0 0" }, children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("b", { children: failure.title }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("ul", { style: { margin: "8px 0 0", paddingLeft: 18, color: "var(--text-muted)", fontSize: 12.5 }, children: failure.lines.map((l, i) => /* @__PURE__ */ jsxRuntimeExports.jsx("li", { style: { marginBottom: 3 }, children: l }, i)) }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { style: { margin: "8px 0 0", fontSize: 12.5, color: "var(--text-muted)" }, children: "Nothing was started and nothing was used from your allowance." })
      ] }) : null
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "modal-foot", children: [
      failure ? (
        // The ticket is spent or stale either way, so there is nothing here that could retry. Review
        // again re-plans against what is on the form — honest about being a fresh start, not a retry.
        /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "btn-primary", onClick: onReview, children: "Review again" })
      ) : /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "btn-primary", disabled: busy, onClick: onStart, children: busy ? "Starting…" : "Start clearance" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "btn-ghost", onClick: onBack, children: "Back to edit" })
    ] })
  ] }) });
}
function Row$3({ label, children }) {
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "modal-row", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "field-label", style: { marginBottom: 0, letterSpacing: ".1em", fontSize: 11 }, children: label }),
    /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { fontSize: 13, color: "var(--text-body)", textAlign: "right" }, children })
  ] });
}
const Muted = ({ children }) => /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { color: "var(--text-muted)" }, children });
function Allowance({ usage }) {
  if (!usage || !usage.capped || usage.dailyRuns == null) return null;
  const left = Math.max(0, usage.dailyRuns - usage.today);
  const none = left === 0;
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "notice", style: { marginTop: 0, ...none ? { borderColor: "var(--tone-high)" } : {} }, children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx("b", { children: none ? "No searches left today" : `${usage.today} of ${usage.dailyRuns} searches used today` }),
    /* @__PURE__ */ jsxRuntimeExports.jsx("p", { style: { margin: "6px 0 0", color: "var(--text-muted)" }, children: none ? "The allowance resets at midnight UTC. Your account contact can run one for you in the meantime." : `${left} left. The allowance resets at midnight UTC.` })
  ] });
}
function ProductMatrix({ products, currentKey }) {
  const { columns, rows } = productMatrix(products, currentKey);
  if (!columns.length) return null;
  const off = columns.filter((c) => !c.available && c.unavailableNote);
  return /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "table-wrap", children: /* @__PURE__ */ jsxRuntimeExports.jsxs("table", { className: "data", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("thead", { children: /* @__PURE__ */ jsxRuntimeExports.jsxs("tr", { children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("th", {}),
        columns.map((c) => /* @__PURE__ */ jsxRuntimeExports.jsxs(
          "th",
          {
            "aria-current": c.current ? "true" : void 0,
            style: { whiteSpace: "normal", ...c.current ? { background: "var(--accent-wash)" } : {} },
            children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { display: "block" }, children: c.name }),
              c.current ? /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { display: "block", fontWeight: 400, color: "var(--text-accent)" }, children: "you are here" }) : null
            ]
          },
          c.key
        ))
      ] }) }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("tbody", { children: rows.map((r) => /* @__PURE__ */ jsxRuntimeExports.jsxs("tr", { children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("td", { children: /* @__PURE__ */ jsxRuntimeExports.jsx("b", { style: { color: "var(--text-strong)" }, children: r.label }) }),
        r.cells.map((cell2, i) => {
          var _a, _b;
          return /* @__PURE__ */ jsxRuntimeExports.jsxs(
            "td",
            {
              "aria-label": cell2.srLabel ? cell2.srLabel + ": " + cell2.text : void 0,
              style: ((_a = columns[i]) == null ? void 0 : _a.current) ? { background: "var(--accent-wash)" } : void 0,
              children: [
                cell2.marker ? /* @__PURE__ */ jsxRuntimeExports.jsx("span", { "aria-hidden": true, style: { marginRight: 6, color: "var(--text-faint)" }, children: cell2.glyph }) : null,
                cell2.text
              ]
            },
            ((_b = columns[i]) == null ? void 0 : _b.key) ?? String(i)
          );
        })
      ] }, r.label)) })
    ] }) }),
    /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "section-hint", style: { margin: "8px 0 0" }, children: LEGEND.map((m) => m.glyph + " " + m.name).join("   ·   ") }),
    off.map((c) => /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { className: "section-hint", style: { margin: "8px 0 0" }, children: [
      c.name,
      " — ",
      c.unavailableNote
    ] }, c.key))
  ] });
}
function Details({ summary, children }) {
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("details", { children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx("summary", { style: { cursor: "pointer", fontWeight: 700, color: "var(--text-strong)", fontSize: 14 }, children: summary }),
    /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { paddingLeft: 2 }, children })
  ] });
}
function Field$1({
  label,
  hint,
  children
}) {
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("label", { style: { display: "block", marginTop: 18 }, children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { fontWeight: 700, color: "var(--text-strong)", fontSize: 13.5 }, children: label }),
    hint ? /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { fontSize: 12.5, color: "var(--text-muted)", margin: "2px 0 7px" }, children: hint }) : /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { height: 7 } }),
    children
  ] });
}
function OptionsUnavailable({
  kind,
  onRetry
}) {
  const limited = kind === "rateLimited";
  return /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "screen", children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "notice prose", style: { borderColor: "var(--tone-high)" }, children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx("b", { children: limited ? "Too many requests just now" : "The search options could not be loaded" }),
    /* @__PURE__ */ jsxRuntimeExports.jsx("p", { style: { margin: "6px 0 0", color: "var(--text-muted)" }, children: limited ? "The portal is pacing requests, so the depths you can choose from have not been fetched. Nothing has been started and nothing has been charged. Try again in a minute." : "The depths you can choose from could not be fetched, so there is nothing here to fill in yet. Nothing has been started and nothing has been charged — a search only begins when you review it and start it yourself." }),
    /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { marginTop: 14 }, children: /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "btn-ghost", onClick: onRetry, children: "Try again" }) })
  ] }) });
}
function Submitted({ go, onAnother }) {
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "screen", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "eyebrow", children: "Queued" }),
    /* @__PURE__ */ jsxRuntimeExports.jsx("h1", { style: { fontSize: 27, margin: "4px 0 14px", color: "var(--text-strong)" }, children: "Clearance started" }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "notice prose", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("b", { children: "It is in the queue" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("p", { style: { margin: "6px 0 0", color: "var(--text-muted)" }, children: "It will appear in Clearances, and the entry there tracks it the whole way — including if it stops early." }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { marginTop: 14, display: "flex", gap: 10 }, children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "btn-primary", onClick: () => go("/portal/clearances"), children: "View in Clearances" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "btn-ghost", onClick: onAnother, children: "Start another" })
      ] })
    ] })
  ] });
}
function statusFor(recipe, levels) {
  const level = levels.find((l) => l.key === recipe.base);
  if (!level) return { kind: "unknownBase" };
  const named = { name: level.name || level.stageLabel, stageLabel: level.stageLabel };
  if (!level.available) return { kind: "unavailable", ...named, note: level.unavailableNote };
  return { kind: "ready", ...named };
}
function isUsable(status) {
  return status.kind === "ready";
}
function displayLabel(recipe) {
  const label = recipe.label.trim();
  return label || "Untitled custom search";
}
function versionLabel(recipe) {
  return recipe.version === null ? null : `v${recipe.version}`;
}
function sortSavedSearches(recipes) {
  return [...recipes].sort((a, b) => {
    const byLabel = displayLabel(a).localeCompare(displayLabel(b), void 0, { sensitivity: "base" });
    return byLabel !== 0 ? byLabel : a.slug.localeCompare(b.slug);
  });
}
function SavedSearches({ ctx }) {
  const account = ctx.owner;
  const needsOwner = ctx.me.allAccounts && account === null;
  const { result, reload } = useLoad(() => api.savedSearches(account), [account]);
  const { result: menu } = useLoad(() => api.searches(account), [account]);
  const levels = (menu == null ? void 0 : menu.kind) === "ok" ? menu.value.products : [];
  const [busy, setBusy] = reactExports.useState(null);
  const [confirming, setConfirming] = reactExports.useState(null);
  const [problem, setProblem] = reactExports.useState(null);
  if (needsOwner) return /* @__PURE__ */ jsxRuntimeExports.jsx(PickOwner, {});
  if (!result) return /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "screen" });
  if (result.kind === "pickAccount") return /* @__PURE__ */ jsxRuntimeExports.jsx(PickOwner, {});
  if (result.kind !== "ok") {
    return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "screen", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx(Heading, {}),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "notice", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("b", { children: result.kind === "rateLimited" ? "Too many requests just now" : "Custom searches could not be loaded" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { style: { margin: "6px 0 0", color: "var(--text-muted)" }, children: result.kind === "rateLimited" ? "The portal is pacing requests. Try again in a minute." : "Nothing has been changed or lost. Try again shortly." })
      ] })
    ] });
  }
  const setRetired = async (row, retired) => {
    setBusy(row.slug);
    setProblem(null);
    const full = await api.savedSearch(account, row.slug);
    if (!isOk(full)) {
      setBusy(null);
      setProblem("That could not be opened just now. Nothing has been changed.");
      return;
    }
    const r = await api.saveSavedSearch(account, row.slug, "save", {
      recipe: { ...full.value.recipe, archived: retired },
      // Naming the version this was based on turns a silent last-writer-wins clobber into a 409 that can
      // be acted on — someone may have edited it in the composer while this list sat open.
      expectedVersion: row.version
    });
    setBusy(null);
    setConfirming(null);
    if (!isOk(r)) {
      setProblem(r.kind === "conflict" ? "Someone else changed this while the list was open. Reload and try again." : `That could not be ${retired ? "retired" : "brought back"}. Nothing has been changed.`);
      return;
    }
    const uncommitted = notCommitted(r);
    if (uncommitted) setProblem(uncommitted);
    reload();
  };
  const rows = sortSavedSearches(result.value);
  const unusable = rows.filter((r) => !r.archived && !isUsable(statusFor(r, levels))).length;
  if (!rows.length) return /* @__PURE__ */ jsxRuntimeExports.jsx(Empty, { go: ctx.go });
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "screen", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx(Heading, {}),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { className: "prose", style: { margin: 0, color: "var(--text-muted)" }, children: [
      "A custom search is a named set-up — how deep to search and where to point it — so a search you run often is run the same way every time. They are built on New clearance: set the levers there, and press ",
      /* @__PURE__ */ jsxRuntimeExports.jsx("b", { children: "Save as search" }),
      "."
    ] }),
    unusable ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "notice", style: { borderLeftColor: "var(--tone-medium)" }, children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("b", { children: unusable === 1 ? "One of these cannot be used as it stands" : `${unusable} of these cannot be used as they stand` }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("p", { style: { margin: "6px 0 0", color: "var(--text-muted)" }, children: "The search underneath is not available right now. The custom search itself is untouched — each row below says which one and why." })
    ] }) : null,
    problem ? /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "notice", style: { borderColor: "var(--tone-high)" }, children: /* @__PURE__ */ jsxRuntimeExports.jsx("b", { children: problem }) }) : null,
    /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { marginTop: 16, display: "flex", justifyContent: "flex-end" }, children: /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "pill", style: { cursor: "pointer" }, onClick: () => ctx.go("/portal/new"), children: "New custom search" }) }),
    /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "table-wrap", style: { marginTop: 10 }, children: /* @__PURE__ */ jsxRuntimeExports.jsxs("table", { className: "data", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("thead", { children: /* @__PURE__ */ jsxRuntimeExports.jsxs("tr", { children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("th", { children: "Custom search" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("th", { children: "Builds on" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("th", { style: { width: 90 }, children: "Version" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("th", { style: { width: 210 } })
      ] }) }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("tbody", { children: rows.map((r) => (
        // The slug is the key half of `account/slug` and is unique; the label is free text and is
        // not, so the label would be an unstable React key on exactly the rows the sort had to
        // break a tie between.
        /* @__PURE__ */ jsxRuntimeExports.jsx(
          SavedRow,
          {
            recipe: r,
            products: levels,
            status: statusFor(r, levels),
            busy: busy === r.slug,
            confirming: confirming === r.slug,
            onEdit: () => ctx.go(`/portal/new?search=${encodeURIComponent(r.slug)}`),
            onRetire: () => r.archived ? void setRetired(r, false) : setConfirming(r.slug),
            onConfirm: () => void setRetired(r, true),
            onCancel: () => setConfirming(null)
          },
          r.slug
        )
      )) })
    ] }) })
  ] });
}
function SavedRow({
  recipe,
  products,
  status,
  busy,
  confirming,
  onEdit,
  onRetire,
  onConfirm,
  onCancel
}) {
  const version = versionLabel(recipe);
  const editable = draftFromSaved({ base: recipe.base }, products) !== null;
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("tr", { style: recipe.archived ? { opacity: 0.55 } : void 0, children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs("td", { children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("b", { "data-anon": "mark", style: { color: "var(--text-strong)" }, children: displayLabel(recipe) }),
      recipe.archived ? /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "pill", style: { fontSize: 10.5, padding: "1px 7px", marginLeft: 8 }, children: "Retired" }) : null
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsx("td", { children: /* @__PURE__ */ jsxRuntimeExports.jsx(BuildsOn, { status }) }),
    /* @__PURE__ */ jsxRuntimeExports.jsx("td", { className: "mono", style: { color: "var(--text-muted)", fontSize: 13 }, children: version ?? /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { color: "var(--text-faint)" }, children: "—" }) }),
    /* @__PURE__ */ jsxRuntimeExports.jsx("td", { children: /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { display: "flex", gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }, children: confirming ? /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx(
        "button",
        {
          type: "button",
          className: "pill",
          style: { cursor: "pointer", fontSize: 12, borderColor: "var(--tone-high)" },
          disabled: busy,
          onClick: onConfirm,
          children: busy ? "Working…" : "Confirm — retire"
        }
      ),
      /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "pill", style: { cursor: "pointer", fontSize: 12 }, onClick: onCancel, children: "Cancel" })
    ] }) : /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
      editable && !recipe.archived ? /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "pill", style: { cursor: "pointer", fontSize: 12 }, onClick: onEdit, children: "Edit" }) : null,
      /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "pill", style: { cursor: "pointer", fontSize: 12 }, disabled: busy, onClick: onRetire, children: busy ? "Working…" : recipe.archived ? "Bring back" : "Retire" })
    ] }) }) })
  ] });
}
function BuildsOn({ status }) {
  if (status.kind === "unknownBase") {
    return /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { color: "var(--text-muted)" }, children: "No longer available" });
  }
  if (status.kind === "unavailable") {
    return /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { color: "var(--text-strong)" }, children: status.name }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { display: "block", fontSize: 12, color: "var(--text-faint)" }, children: status.stageLabel }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { display: "block", fontSize: 12.5, color: "var(--text-muted)" }, children: status.note })
    ] });
  }
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { color: "var(--text-strong)" }, children: status.name }),
    /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { display: "block", fontSize: 12, color: "var(--text-faint)" }, children: status.stageLabel })
  ] });
}
function Empty({ go }) {
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "screen", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx(Heading, {}),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "notice", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("b", { children: "No custom searches yet" }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { className: "prose", style: { margin: "6px 0 0", color: "var(--text-muted)" }, children: [
        "A custom search is a named set-up — how deep to search and where to point it. Build one on New clearance: set the levers, see what it costs, then press ",
        /* @__PURE__ */ jsxRuntimeExports.jsx("b", { children: "Save as search" }),
        ". It becomes a single choice the next time, instead of a form to fill in the same way every time."
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { marginTop: 14 }, children: /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "pill", style: { cursor: "pointer" }, onClick: () => go("/portal/new"), children: "Build one on New clearance" }) })
    ] })
  ] });
}
function PickOwner() {
  return /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "screen", children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "notice", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx("b", { children: "Choose a brand owner first" }),
    /* @__PURE__ */ jsxRuntimeExports.jsx("p", { style: { margin: "6px 0 0", color: "var(--text-muted)" }, children: "Custom searches belong to one brand owner. Pick one at the top left." })
  ] }) });
}
function Heading() {
  return /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "eyebrow", children: "Custom searches" }),
    /* @__PURE__ */ jsxRuntimeExports.jsx("h1", { style: { fontSize: 27, margin: "4px 0 6px", color: "var(--text-strong)" }, children: "Custom searches" })
  ] });
}
const readTheme = () => document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
function Preferences({ ctx }) {
  const [theme, setThemeState] = reactExports.useState(readTheme);
  const applyTheme = (next) => {
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("cordillera-theme", next);
    } catch {
    }
    setThemeState(next);
  };
  const role = ctx.me.role === "staff" ? staffLabel(ctx.me.brand) : "Client";
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "screen", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "eyebrow", children: "Settings" }),
    /* @__PURE__ */ jsxRuntimeExports.jsx("h1", { style: { fontSize: 27, margin: "4px 0 6px", color: "var(--text-strong)" }, children: "Your preferences" }),
    /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "prose", style: { margin: 0, color: "var(--text-muted)" }, children: "Who you are signed in as, and how the portal looks on this computer." }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "measure", style: { "--screen-measure": "720px" }, children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs(Section, { title: "Your sign-in", hint: `Held by ${operatorName(ctx.me.brand)}. Nothing here can be changed from this page.`, children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("dl", { style: { margin: 0, display: "grid", gridTemplateColumns: "auto 1fr", gap: "8px 18px", fontSize: 14 }, children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("dt", { style: { color: "var(--text-muted)" }, children: "Address" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("dd", { style: { margin: 0, color: "var(--text-strong)", wordBreak: "break-all" }, "data-anon": "mark", children: ctx.me.email || "—" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("dt", { style: { color: "var(--text-muted)" }, children: "Role" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("dd", { style: { margin: 0, color: "var(--text-strong)" }, children: role }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("dt", { style: { color: "var(--text-muted)" }, children: "Brand owners" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("dd", { style: { margin: 0, color: "var(--text-strong)" }, children: ctx.me.allAccounts ? `Every brand owner ${operatorName(ctx.me.brand)} holds` : ctx.me.accounts.length ? /* @__PURE__ */ jsxRuntimeExports.jsx("span", { "data-anon": "mark", children: ctx.me.accounts.join(", ") }) : /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { color: "var(--text-muted)" }, children: "None recorded against this address." }) })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { style: { margin: "14px 0 0", fontSize: 13, color: "var(--text-muted)" }, children: [
          "To change the address, the role or the brand owners on it, ask ",
          operatorName(ctx.me.brand),
          " — enrolment is done for you, not from this page."
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("a", { className: "pill", href: "/portal/sign-out", style: { display: "inline-block", marginTop: 12, textDecoration: "none" }, children: "Log out" })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs(Section, { title: "Appearance", hint: "Applies straight away, and is remembered in this browser.", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { display: "flex", gap: 10, flexWrap: "wrap" }, children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(ThemeOption, { label: "Light", value: "light", current: theme, onPick: applyTheme }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(ThemeOption, { label: "Dark", value: "dark", current: theme, onPick: applyTheme })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { style: { margin: "12px 0 0", fontSize: 13, color: "var(--text-muted)" }, children: "The same choice is on the top bar, under the circle icon — this page and that button set one and the same setting." })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs(Section, { title: "Blurring names while you share a screen", hint: "There is one control for this, and it is on the top bar.", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { display: "flex", alignItems: "center", gap: 12 }, children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs(
            "span",
            {
              className: "pill",
              style: { display: "inline-flex", alignItems: "center", gap: 7, padding: "4px 11px" },
              children: [
                /* @__PURE__ */ jsxRuntimeExports.jsx(Icon, { name: "eye", size: 15 }),
                "Top bar"
              ]
            }
          ),
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { fontSize: 13.5, color: "var(--text-muted)" }, children: "The eye button, to the left of your initials." })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { style: { margin: "12px 0 0", color: "var(--text-muted)", fontSize: 13.5 }, children: "Pressing it blurs every brand name, mark and brand owner the portal puts on screen — in the lists, on this page, in the heading above a report, and the report itself — so you can put the portal on a call or a projector without showing whose names are in clearance. Nothing is hidden from you: the text is still there and still selectable by the page, it is only blurred on screen. Press the button again to bring the names back." }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "notice", style: { marginTop: 14, borderLeftColor: "var(--tone-medium)" }, children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("b", { style: { color: "var(--text-strong)" }, children: "An open report blurs completely" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("p", { style: { margin: "6px 0 0", color: "var(--text-muted)" }, children: "A report is a separate document held inside the page, and it can only be covered whole. With a report open, the button blurs all of it rather than just the names in it. That is deliberate — it is the safer way round for a screen you are sharing." })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { style: { margin: "10px 0 0", color: "var(--text-muted)", fontSize: 13.5 }, children: "It starts switched off every time you open the portal, so reloading the page brings the names back whether you meant it to or not. Turn it on again before you share." })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "notice quiet", style: { marginTop: 26 }, children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("b", { style: { color: "var(--text-strong)" }, children: "These two settings stay on this computer" }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { style: { margin: "6px 0 0", color: "var(--text-muted)" }, children: [
          operatorName(ctx.me.brand, { lead: true }),
          " does not store them against your account. The appearance choice is kept by this browser, so it holds for this computer and this browser only — sign in somewhere else, or use a different browser here, and you will get the light theme again until you set it. The screen-share blur is not kept at all: it lasts until you reload or close the page."
        ] })
      ] })
    ] })
  ] });
}
function ThemeOption({
  label,
  value,
  current,
  onPick
}) {
  const on = current === value;
  return /* @__PURE__ */ jsxRuntimeExports.jsxs(
    "button",
    {
      type: "button",
      "aria-pressed": on,
      onClick: () => onPick(value),
      style: {
        display: "inline-flex",
        alignItems: "center",
        gap: 9,
        padding: "9px 16px",
        borderRadius: 10,
        border: `1px solid ${on ? "var(--accent)" : "var(--border-hairline)"}`,
        background: on ? "var(--accent-wash)" : "var(--surface-raised)",
        color: on ? "var(--text-accent)" : "var(--text-strong)",
        fontSize: 14,
        fontWeight: on ? 700 : 500,
        cursor: "pointer"
      },
      children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(Icon, { name: "theme", size: 16 }),
        label,
        on ? /* @__PURE__ */ jsxRuntimeExports.jsx(Icon, { name: "check", size: 15 }) : null
      ]
    }
  );
}
function Section({
  title,
  hint,
  children
}) {
  return /* @__PURE__ */ jsxRuntimeExports.jsxs(
    "section",
    {
      style: {
        marginTop: 22,
        padding: "18px 20px",
        borderRadius: 12,
        border: "1px solid var(--border-hairline)",
        background: "var(--surface-raised)"
      },
      children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("h2", { style: { fontSize: 15, fontWeight: 700, color: "var(--text-strong)", margin: 0 }, children: title }),
        hint ? /* @__PURE__ */ jsxRuntimeExports.jsx("p", { style: { margin: "2px 0 14px", fontSize: 13, color: "var(--text-muted)" }, children: hint }) : /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { height: 14 } }),
        children
      ]
    }
  );
}
const WHAT_YOU_CAN_DO = [
  "Start a clearance and triage what comes back",
  "Watch it run, and add context while it is still early",
  "Interrogate the reasoning — not just the findings, the thinking behind them",
  "Ask what-if: why a finding was rated as it was, what changes if the goods narrow"
];
function Connect({ offer }) {
  var _a, _b, _c;
  const [open, setOpen] = reactExports.useState(false);
  const [said, setSaid] = reactExports.useState(null);
  const [revealed, setRevealed] = reactExports.useState(null);
  if (!offer.served) {
    return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ai-absent-row", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("strong", { children: offer.name }),
      " — ",
      offer.reason,
      ". ",
      offer.fix ? `${offer.fix.slice(0, 1).toUpperCase()}${offer.fix.slice(1)}.` : null
    ] });
  }
  const press = async () => {
    if (open) {
      setOpen(false);
      setSaid(null);
      setRevealed(null);
      return;
    }
    setOpen(true);
    setSaid(null);
    setRevealed(null);
    if (offer.command) {
      const ok = await copy(offer.command);
      setSaid(ok ? `Copied. Paste it into ${offer.name}.` : null);
      launchIfOffered(offer);
      return;
    }
    const r = await api.connectKey();
    if (r.kind !== "ok") {
      setSaid("We could not set this up just now. Try again, or ask us.");
      return;
    }
    const line = `${r.value.address}
${r.value.key}`;
    if (await copy(line)) {
      setSaid(`Copied. Paste it into ${offer.name}.`);
      launchIfOffered(offer);
    } else setRevealed({ address: r.value.address, key: r.value.key });
  };
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ai-row", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs(
      "button",
      {
        type: "button",
        className: open ? "btn-ghost ai-btn ai-btn-on" : "btn-ghost ai-btn",
        "aria-expanded": open,
        onClick: () => void press(),
        children: [
          "Connect ",
          offer.name
        ]
      }
    ),
    open ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ai-open", children: [
      said ? /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "ai-said", children: said }) : null,
      offer.steps.length ? /* @__PURE__ */ jsxRuntimeExports.jsx("ol", { className: "ai-steps", children: offer.steps.map((line) => /* @__PURE__ */ jsxRuntimeExports.jsx("li", { children: line }, line)) }) : null,
      offer.command ? /* @__PURE__ */ jsxRuntimeExports.jsxs("details", { className: "ai-advanced", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("summary", { children: ((_a = offer.stdio) == null ? void 0 : _a.kind) === "config" ? `Advanced — the block ${offer.name} needs, if you would rather paste it yourself` : "Advanced — the one-line command, if you would rather run it yourself" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "ai-said", children: ((_b = offer.stdio) == null ? void 0 : _b.kind) === "config" ? `${offer.name} needs this in ${offer.stdio.where}.` : "Run this once on this machine." }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("pre", { className: "ai-pre", children: offer.command }),
        ((_c = offer.stdio) == null ? void 0 : _c.after) ? /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "ai-said", children: offer.stdio.after }) : null
      ] }) : null,
      revealed ? /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { className: "ai-said", children: [
          "Your browser would not let us copy it. Paste these two lines into ",
          offer.name,
          " — they are yours, and they will not be shown again."
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("pre", { className: "ai-pre", children: [
          revealed.address,
          "\n",
          revealed.key
        ] })
      ] }) : null
    ] }) : null
  ] });
}
function launchIfOffered(offer) {
  if (!offer.launch) return;
  window.open(offer.launch.url, "_blank", "noopener,noreferrer");
}
async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
function UseYourAI({ ctx }) {
  const [access, setAccess] = reactExports.useState(null);
  reactExports.useEffect(() => {
    let live = true;
    void api.mcpAccess().then((r) => {
      if (live && r.kind === "ok") setAccess(r.value);
    });
    return () => {
      live = false;
    };
  }, [ctx.me.email]);
  const offers = (access == null ? void 0 : access.offers) ?? [];
  const usable = offers.filter((o) => o.served).slice().sort((a, b) => Number(!a.command) - Number(!b.command));
  const absent = offers.filter((o) => !o.served);
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "screen ai-screen", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx("h1", { className: "ai-title", children: "Use your own AI" }),
    /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "ai-lead", children: "Run and interrogate clearances from the assistant you already use — by voice, by email, or just by asking." }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("section", { className: "ai-can", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("h2", { children: "What you can do" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("ul", { children: WHAT_YOU_CAN_DO.map((line) => /* @__PURE__ */ jsxRuntimeExports.jsx("li", { children: line }, line)) }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { className: "ai-can-foot", children: [
        "Every report also has an ",
        /* @__PURE__ */ jsxRuntimeExports.jsx("strong", { children: "Ask AI" }),
        " button that jumps straight to that run."
      ] })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { className: "ai-doors", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("strong", { children: "This is you, with your own reach." }),
      " An assistant you set up here can do what you can do on these screens — start a clearance for your brands, follow it while it runs, ask about your own reports — and nothing beyond that. There is a second, far more powerful way in, for the team that runs this service. It is not this one, and nothing on this page opens it."
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsx("h2", { className: "ai-connect-head", children: "Connect it" }),
    /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "ai-buttons", children: usable.map((o) => /* @__PURE__ */ jsxRuntimeExports.jsx(Connect, { offer: o }, o.id)) }),
    absent.length ? /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "ai-absent", children: absent.map((o) => /* @__PURE__ */ jsxRuntimeExports.jsx(Connect, { offer: o }, o.id)) }) : null,
    /* @__PURE__ */ jsxRuntimeExports.jsxs("details", { className: "ai-help", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("summary", { children: "Not connecting, or want to set it up yourself?" }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ai-help-body", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { children: [
          "Press the button for your assistant and it will tell you the next thing to do — usually three taps inside that app’s own settings. If your assistant is not listed, pick",
          /* @__PURE__ */ jsxRuntimeExports.jsx("strong", { children: " Another agent" }),
          ": it will give you both of the things any assistant can take."
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { children: [
          "Once it is connected, you do not have to learn anything new. Ask it in your own words —",
          /* @__PURE__ */ jsxRuntimeExports.jsx("em", { children: " “start a knockout for our new drinks name across the US”" }),
          ", or",
          /* @__PURE__ */ jsxRuntimeExports.jsx("em", { children: " “why did you rate that one high?”" }),
          " — and it will do the same work you would do on these screens."
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { children: "If a press does not finish, the most common reason is that your assistant runs somewhere this service cannot be reached from. The team who set this up can tell you in a sentence." }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { className: "ai-help-doc", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("a", { href: "/portal/connect-help", target: "_blank", rel: "noreferrer", children: "The full technical instructions" }),
          " — written for an engineer, or for an assistant reading on your behalf."
        ] })
      ] })
    ] })
  ] });
}
const CODE_OWNED = ["frameworkPath", "workedExamplesPath", "allowedRecipes", "jxPolicy", "runCaps"];
const PATH_FIELDS = /* @__PURE__ */ new Set(["frameworkPath", "workedExamplesPath"]);
function visibleReadOnlyFields(readOnly, staff) {
  return CODE_OWNED.filter((k) => readOnly[k] !== void 0 && (staff || !PATH_FIELDS.has(k)));
}
const FIELD_GROUPS = [
  { id: "identity", label: "Identity" },
  { id: "defaults", label: "Search defaults" }
];
const rootKey = (spec) => {
  var _a;
  return ((_a = spec.path) == null ? void 0 : _a[0]) ?? spec.key;
};
function readField(draft, spec) {
  if (!spec.path) return draft[spec.key];
  let cur = draft;
  for (const seg of spec.path) {
    if (typeof cur !== "object" || cur === null) return void 0;
    cur = cur[seg];
  }
  return cur;
}
function isSet(draft, spec) {
  return readField(draft, spec) !== void 0;
}
const CLEARED_LABEL = "Generic default";
const PROFILE_FIELDS = [
  // ── who the brand owner is ──
  {
    key: "name",
    label: "Legal name",
    kind: "text",
    group: "identity",
    hint: "Used so a search does not flag the client against their own marks. Should be the registered owner name."
  },
  {
    key: "matchDomains",
    label: "Domains",
    kind: "lines",
    group: "identity",
    commaSeparated: true,
    // A hostname, not a URL: at least one dot, no scheme, no path, no spaces. Deliberately loose — this
    // refuses "http://example.com/x" and "not a domain", and does not attempt to know which suffixes
    // exist. A validator that rejects a real domain is worse than one that admits a fake one, because
    // only the first stops someone recording something true.
    item: {
      ok: (e) => /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(e),
      expected: "a domain like example.com"
    },
    hint: "Common law domains, e.g. example.com, one per line or comma-separated. Used to recognise the client."
  },
  {
    key: "selfExclusionOwners",
    label: "Own trading names",
    kind: "lines",
    group: "identity",
    hint: "One per line. Marks held by the client that should never be reported as a conflict with themselves."
  },
  // ── what a clearance does when the request does not say ──
  // `industry` moved down out of the identity run: it scopes what a search LOOKS AT, which is a default,
  // not a fact about who the client is.
  // It had no hint at all, which left the first row of the project form an unlabelled box.
  {
    key: "industry",
    label: "Industry",
    kind: "text",
    group: "defaults",
    hint: "The trade this name sits in. Sets the sector a matter is read against."
  },
  { key: "defaultClasses", label: "Default classes", kind: "numbers", group: "defaults", picker: "classes", hint: "Default Nice classes, 1-45, always changeable at search time. Commas, spaces or new lines all work." },
  {
    key: "defaultJurisdictions",
    label: "Default jurisdictions",
    kind: "lines",
    group: "defaults",
    commaSeparated: true,
    picker: "territories",
    // ASSISTIVE, NOT STRICT ( item 7). The engine deliberately carries a territory it
    // does not recognise, so this must never refuse — it says so and stores it. What it replaces is
    // SILENCE: the field had no `item` at all, so `fieldNotices` returned nothing for anything, and the
    // owner's own example typed into the live page — "USFrance" — produced no notice whatsoever. That is
    // the whole of "the Check button appears to check nothing": the mechanism was present and unarmed on
    // the two fields he actually tested.
    //
    // The vocabulary is the composer's own, not a second list. A picker that suggests a territory the box
    // then flags as unknown would be two controls disagreeing under one label.
    item: { ok: isKnownTerritory, expected: "a territory from the picker below" },
    hint: "One per line or comma-separated. Searched by default unless a clearance specifies otherwise."
  },
  {
    key: "platforms",
    label: "Marketplaces",
    kind: "lines",
    group: "defaults",
    // MIRRORS THE SERVER'S RULE, and this is a COPY because portal-ui cannot import from driver/ — the
    // same constraint the `defaultProduct` note below describes. A copy drifts silently, so
    // driver/test/the-marketplace-rule-is-the-same-on-both-sides.test.mjs reads both sources and fails
    // if they diverge. That arm is the reason this copy is allowed to exist.
    //
    // `driver/profiles.mjs platformEntryErrors` requires a bare store domain and REFUSES anything else —
    // a broken profile bricks every run under it. Typing "Amazon" here was accepted in silence by the
    // page and refused by the server, which is what "validation is bollox" describes (
    // items 4 and 7). The notice is a `check` rather than a refusal because this file never refuses.
    item: {
      ok: (e) => {
        const d = e.trim().toLowerCase();
        return d !== "web" && !/\s/.test(d) && /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(d);
      },
      expected: "a bare store domain like amazon.com"
    },
    hint: "One per line. A project can add to this list; it can never remove one."
  },
  {
    key: "riskAppetite",
    label: "Risk appetite",
    kind: "prose",
    group: "defaults",
    // Level-NEUTRAL wording, deliberately: this same spec renders on the project form, where "how this
    // BRAND OWNER wants risk communicated" was describing the wrong thing entirely. And the two clauses
    // that survive the cut are the two the server enforces — plain prose, and never a rating input.
    hint: 'How risk is put to this client: what to lead with, how cautious to be. Example: "Lead with the biggest risk. Flag anything that could be a problem, even if unlikely." Changes how the report reads, never what is rated.'
  },
  // MARKETPLACE LISTING SIZE HAS NO CONTROL, ON ANY SURFACE. Owner ruling, 2026-08-29:
  // "if it doesn't actually affect search why is it there — get rid of it completely. there is no such
  // thing as staff only." It was removed from this page AND from the staff editor in the same change.
  //
  // THE STORED FIELD SURVIVES AND MUST. `marketplaceDensity: "dense"` shrinks the grid cell budget from
  // 98 to 16 so a byte-heavy marketplace's verbatim stdout cannot overflow the worker output channel and
  // truncate the ledger mid-JSON — a measured incident, cited by name above profiles.mjs gridCellBudget.
  // Three shipped profiles carry it today. It is set in the config bundle at onboarding and read by the
  // engine; what went away is asking a lawyer to answer it.
  //
  // OMITTING IT HERE DOES NOT DELETE IT — that is this file's seed-and-edit rule at the top, the same
  // ruling as `delivery.email` below. The STAFF editor had no such protection: it builds its payload
  // field by field, so dropping its input would have posted a profile with the key missing and the
  // server would have written that. driver/profile-service.mjs preserves it from disk instead, and
  // driver/test/a-removed-control-does-not-delete-the-setting-behind-it.test.mjs is what proves it.
  // Options are NOT listed here. The levels are a registry in driver/search-policy.mjs, which portal-ui
  // cannot import (separate workspace, self-contained bundle); a literal copy would drift silently the
  // first time a level is added. Profile.tsx loads them from api.searches() instead, which is that same
  // registry served over the wire.
  {
    key: "defaultProduct",
    label: "Default search depth",
    kind: "choice",
    group: "defaults",
    clearWith: "",
    customerOnly: true,
    // "Availability is confirmed when a run starts, not here" survives a cut to a third of the length,
    // because it is the only load-bearing clause: this page cannot check whether a depth is switched on,
    // and without saying so a lawyer reads a saved default as a guarantee.
    hint: "The depth used when a request does not ask for one. Whether it is available is settled when the run starts, not here."
  },
  // Both delivery sub-keys are customerOnly for a reason that is NOT the defaultProduct reason, so
  // it is spelled out separately below rather than folded into that paragraph.
  // `delivery.email` IS NOT RENDERED, and its absence is the same ruling as `template` below rather than
  // an oversight. The choice is dead in the engine: driver/profiles.mjs refuses any value but "summary"
  // and normalizeDelivery folds the retired "table" back to it at the single point every caller reads,
  // so both options composed the same cover note. A dropdown that cannot change anything is worse than
  // no dropdown — the defect class the knockout's Export menu closed, where a menu offered commands the
  // document could not run.
  //
  // NOT DELETED FROM STORED PROFILES, and it must not be: an unrendered key rides along untouched by
  // this file's own seed-and-edit rule, so a profile carrying `email: "summary"` keeps it and keeps
  // validating. Removing the control removes the choice, never the data.
  // THE "YES" OPTION IS GONE, and the field is NOT two-state (, the interim).
  //
  // `true` is retired: normalizeDelivery deletes it, so it renders identically to absent and the option
  // claimed a distinction the output cannot carry — the same defect as the Report email control above.
  //
  // WHAT MUST NOT HAPPEN HERE: this field stays THREE-STATE on the wire. `false` is a customer
  // instructing us to strip the confidentiality line and is a real instruction; absent is no opinion and
  // gets the default marking. Collapsing those two answered both with silence and shipped a clearance
  // with no line at all. Do not "simplify" this to a boolean.
  //
  // THE PAIR IS NAMED, and the interim's known cost is paid: the owner ruled "Privileged & Confidential"
  // / "No marking" on 2026-08-28. The cleared option carries its own words via
  // `clearedLabel` rather than the shared generic one, which is what stops a sweep of that shared label
  // renaming a legal marking by accident.
  {
    key: "delivery.privileged",
    label: "Privileged & Confidential header",
    kind: "boolean",
    group: "defaults",
    path: ["delivery", "privileged"],
    // The owner's two words, ruled 2026-08-28. They are a PAIR and read as one:
    // the cleared option names the marking the report carries, this one names its removal. Neither
    // needs the other to be understood, which "The house default" against "No" did.
    choices: [{ value: "no", label: "No marking" }],
    clearedLabel: "Privileged & Confidential",
    retiredValue: "yes",
    customerOnly: true,
    hint: "Marks the report and its cover note as privileged legal advice."
  }
  // delivery.style and delivery.template are deliberately absent. `style` is prose that passes a second,
  // separate validator (assertContextPackShape) and needs a considered editor, not a text box; `template`
  // has exactly one legal value today, and a dropdown with one option is not a control.
];
const PROJECT_EDITABLE = /* @__PURE__ */ new Set([
  "platforms",
  "defaultClasses",
  "defaultJurisdictions",
  // `marketplaceDensity` stays in this set and is NOT a leftover: this set mirrors what the ENGINE
  // accepts in an overlay (profiles.mjs PROJECT_KEYS), which is a different question from what a form
  // offers. It has no control on any surface — see the tombstone above — so projectFields() renders
  // nothing for it either way.
  "marketplaceDensity",
  "delivery",
  "riskAppetite",
  "industry",
  "defaultProduct"
]);
const projectFields = () => PROFILE_FIELDS.filter((f) => PROJECT_EDITABLE.has(rootKey(f)) && !f.customerOnly);
const choiceLabel = (spec, value) => {
  var _a, _b;
  return ((_b = (_a = spec.choices) == null ? void 0 : _a.find((c) => c.value === value)) == null ? void 0 : _b.label) ?? null;
};
function parseLines(raw, commaSeparated = false) {
  const parts = commaSeparated ? raw.split(/[\n,]/) : raw.split("\n");
  return parts.map((s) => s.trim()).filter(Boolean);
}
function parseNumbers(raw) {
  const seen = /* @__PURE__ */ new Set();
  for (const part of raw.split(/[\s,]+/)) {
    const n = Number(part.trim());
    if (Number.isInteger(n) && n >= 1 && n <= 45) seen.add(n);
  }
  return [...seen].sort((a, b) => a - b);
}
function rejectedNumbers(raw) {
  const out = [];
  for (const part of raw.split(/[\s,]+/)) {
    const t = part.trim();
    if (!t) continue;
    const n = Number(t);
    if (!(Number.isInteger(n) && n >= 1 && n <= 45)) out.push(t);
  }
  return out;
}
function toInput(value, kind) {
  if (value == null) return "";
  if (kind === "lines") return Array.isArray(value) ? value.map(String).join("\n") : String(value);
  if (kind === "numbers") return Array.isArray(value) ? value.join(", ") : String(value);
  if (kind === "boolean" && typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "string") return value;
  return typeof value === "object" ? JSON.stringify(value, null, 2) : String(value);
}
const fieldInput = (source, spec) => {
  const shown = toInput(readField(source, spec), spec.kind);
  return spec.retiredValue !== void 0 && shown === spec.retiredValue ? "" : shown;
};
function applyField(draft, spec, raw) {
  const next = { ...draft };
  const trimmed = raw.trim();
  if (!trimmed) {
    if (spec.clearWith !== void 0) {
      next[spec.key] = spec.clearWith;
      return next;
    }
    if (spec.path) return clearPath(next, spec.path);
    delete next[spec.key];
    return next;
  }
  const value = spec.kind === "lines" ? parseLines(raw, spec.commaSeparated) : spec.kind === "numbers" ? parseNumbers(raw) : spec.kind === "boolean" ? trimmed === "yes" : trimmed;
  if (spec.path) return writePath(next, spec.path, value);
  next[spec.key] = value;
  return next;
}
function boxValue(state, spec) {
  const typed = state.edits[spec.key];
  return typed !== void 0 ? typed : fieldInput(state.draft, spec);
}
function fieldNotices(spec, raw) {
  const out = [];
  if (!raw.trim()) return out;
  if (spec.kind === "numbers") {
    const bad = rejectedNumbers(raw);
    if (bad.length) {
      out.push({
        tone: "dropped",
        message: `Not saved: ${bad.join(", ")}. Nice classes are whole numbers from 1 to 45.`
      });
    }
    return out;
  }
  if (spec.kind !== "lines") return out;
  const items = parseLines(raw, spec.commaSeparated);
  if (spec.commaSeparated && raw.includes(",")) {
    out.push({
      tone: "reshaped",
      message: `Saved as ${items.length} ${items.length === 1 ? "entry" : "separate entries"}. Commas and new lines both separate them.`
    });
  }
  if (spec.item) {
    const bad = items.filter((e) => !spec.item.ok(e));
    if (bad.length) {
      out.push({
        tone: "check",
        message: `Saved, but check ${bad.join(", ")} — each entry should be ${spec.item.expected}.`
      });
    }
  }
  return out;
}
function chosenEntries(spec, raw) {
  if (spec.kind === "numbers") return parseNumbers(raw).map(String);
  return parseLines(raw, spec.commaSeparated);
}
function toggleEntry(spec, raw, entry) {
  const norm = (x) => x.trim().toLowerCase();
  const current = chosenEntries(spec, raw);
  const without = current.filter((e) => norm(e) !== norm(entry));
  const next = without.length < current.length ? without : [...current, entry.trim()];
  if (spec.kind === "numbers") {
    return [...new Set(next.map((n) => Number(n)))].filter((n) => Number.isInteger(n)).sort((a, b) => a - b).join(", ");
  }
  return next.join("\n");
}
function writePath(draft, path, value) {
  const [head, ...rest] = path;
  if (head === void 0) return draft;
  if (!rest.length) return { ...draft, [head]: value };
  const child = draft[head];
  const base = typeof child === "object" && child !== null && !Array.isArray(child) ? child : {};
  return { ...draft, [head]: writePath(base, rest, value) };
}
function clearPath(draft, path) {
  const [head, ...rest] = path;
  if (head === void 0) return draft;
  const next = { ...draft };
  if (!rest.length) {
    delete next[head];
    return next;
  }
  const child = next[head];
  if (typeof child !== "object" || child === null || Array.isArray(child)) return next;
  const pruned = clearPath(child, rest);
  if (Object.keys(pruned).length === 0) delete next[head];
  else next[head] = pruned;
  return next;
}
function revokedPlatforms(customer, project) {
  if (!Array.isArray(project)) return [];
  const kept = new Set((project ?? []).map((p) => String(p).trim().toLowerCase()));
  return (customer ?? []).filter((p) => !kept.has(String(p).trim().toLowerCase()));
}
function stripCodeOwned(draft) {
  const out = { ...draft };
  for (const f of CODE_OWNED) delete out[f];
  return out;
}
const TONE$1 = {
  dropped: { color: "var(--tone-high)", weight: 600 },
  check: { color: "var(--tone-medium)", weight: 600 },
  reshaped: { color: "var(--text-muted)", weight: 400 }
};
function FieldNotices({ notices }) {
  if (!notices.length) return null;
  return /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { marginTop: 5 }, children: notices.map((n, i) => /* @__PURE__ */ jsxRuntimeExports.jsx(
    "div",
    {
      role: "status",
      style: { fontSize: 12.5, lineHeight: 1.45, color: TONE$1[n.tone].color, fontWeight: TONE$1[n.tone].weight },
      children: n.message
    },
    `${n.tone}-${i}`
  )) });
}
const CLASSES = Array.from({ length: 45 }, (_, i) => String(i + 1));
const TERRITORIES = [...REGIONS, ...COUNTRIES];
const chipStyle = (on) => ({
  cursor: "pointer",
  fontSize: 12,
  padding: "2px 8px",
  borderRadius: 999,
  border: `1px solid ${on ? "var(--accent)" : "var(--border-hairline)"}`,
  background: on ? "var(--accent-wash)" : "var(--surface-raised)",
  color: on ? "var(--text-accent)" : "var(--text-muted)"
});
function FieldPicker({
  spec,
  value,
  onChange
}) {
  const [query, setQuery] = reactExports.useState("");
  if (!spec.picker) return null;
  const chosen = chosenEntries(spec, value);
  const isOn = (e) => chosen.some((c) => c.trim().toLowerCase() === e.toLowerCase());
  const toggle = (e) => onChange(toggleEntry(spec, value, e));
  if (spec.picker === "classes") {
    return /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }, children: CLASSES.map((c) => /* @__PURE__ */ jsxRuntimeExports.jsx(
      "button",
      {
        type: "button",
        onClick: () => toggle(c),
        style: chipStyle(isOn(c)),
        "aria-pressed": isOn(c),
        "aria-label": `Nice class ${c}`,
        children: c
      },
      c
    )) });
  }
  const suggestions = matchTerritoriesIn(TERRITORIES, query, chosen, 8);
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { marginTop: 6 }, children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx(
      "input",
      {
        value: query,
        onChange: (e) => setQuery(e.target.value),
        placeholder: "Find a territory to add — or type your own above",
        "aria-label": "Find a territory",
        style: {
          width: "100%",
          padding: "6px 9px",
          borderRadius: 8,
          fontSize: 13,
          border: "1px solid var(--border-hairline)",
          background: "var(--surface-sunken)",
          color: "var(--text-strong)",
          fontFamily: "inherit"
        }
      }
    ),
    suggestions.length ? /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { display: "flex", flexWrap: "wrap", gap: 4, marginTop: 5 }, children: suggestions.map((t) => /* @__PURE__ */ jsxRuntimeExports.jsxs("button", { type: "button", onClick: () => {
      toggle(t);
      setQuery("");
    }, style: chipStyle(false), children: [
      "+ ",
      t
    ] }, t)) }) : null,
    chosen.length ? /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { display: "flex", flexWrap: "wrap", gap: 4, marginTop: 5 }, children: chosen.map((t) => /* @__PURE__ */ jsxRuntimeExports.jsxs(
      "button",
      {
        type: "button",
        onClick: () => toggle(t),
        style: chipStyle(true),
        "aria-label": `Remove ${t}`,
        children: [
          t,
          " ×"
        ]
      },
      t
    )) }) : null
  ] });
}
const CHAR_MAX = 8e3;
function ContextPackEditor({
  value,
  onChange,
  title,
  hint,
  rows = 8
}) {
  const over = value.length > CHAR_MAX;
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { marginTop: 26 }, children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "eyebrow", children: title }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("label", { style: { display: "block", marginTop: 14 }, children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { fontSize: 12.5, color: "var(--text-muted)", margin: "2px 0 7px" }, children: hint }),
      /* @__PURE__ */ jsxRuntimeExports.jsx(
        "textarea",
        {
          value,
          onChange: (e) => onChange(e.target.value),
          rows,
          "data-anon": "mark",
          className: "ctx-input",
          style: { width: "100%", resize: "vertical", lineHeight: 1.5 }
        }
      )
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { marginTop: 6, fontSize: 12, color: over ? "var(--tone-high)" : "var(--text-muted)" }, children: [
      value.length.toLocaleString(),
      " / ",
      CHAR_MAX.toLocaleString(),
      " characters",
      over ? " — too long to save. Curate it: a big pack dilutes the priors that matter." : ""
    ] })
  ] });
}
function Profile({ ctx }) {
  const account = ctx.owner;
  const needsOwner = ctx.me.allAccounts && account === null;
  const { result, reload } = useLoad(() => api.profile(account), [account]);
  const loaded = (result == null ? void 0 : result.kind) === "ok" ? result.value : null;
  const { result: searchesResult } = useLoad(() => api.searches(account), [account]);
  const productChoices = searchesResult == null ? null : searchesResult.kind === "ok" ? searchesResult.value.products.map((l) => ({
    value: l.key,
    // Availability is a runtime fact the portal is TOLD, not one it can compute. A level that
    // is not built can still be chosen as a default; it clarifies at admission. Saying so on
    // the option is better than hiding it and leaving the account's real default unexplained.
    // Name first, stage after a middot — never a second em dash, because the unavailable arm
    // already uses one. The stage stays: this is the one control where the reader is picking a
    // position on the ladder, and no effort meter is on screen to carry that instead.
    label: l.available ? `${l.name || l.stageLabel} · ${l.stageLabel}` : `${l.name || l.stageLabel} · ${l.stageLabel} — not available yet`
  })) : [];
  const [draft, setDraft] = reactExports.useState(null);
  const [pack, setPack] = reactExports.useState(null);
  const [busy, setBusy] = reactExports.useState(false);
  const [problem, setProblem] = reactExports.useState(null);
  const [edits, setEdits] = reactExports.useState({});
  const [checked, setChecked] = reactExports.useState(false);
  const [saved, setSaved] = reactExports.useState(null);
  reactExports.useEffect(() => {
    if (loaded) {
      setDraft(loaded.profile);
      setPack(loaded.contextPack);
      setEdits({});
    }
  }, [loaded]);
  const dirty = reactExports.useMemo(
    () => loaded != null && (draft != null && JSON.stringify(draft) !== JSON.stringify(loaded.profile) || pack != null && pack !== loaded.contextPack),
    [draft, pack, loaded]
  );
  useUnsaved(dirty);
  if (needsOwner || (result == null ? void 0 : result.kind) === "pickAccount") {
    return /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "screen", children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "notice", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("b", { children: "Choose a brand owner first" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("p", { style: { margin: "6px 0 0", color: "var(--text-muted)" }, children: "A profile belongs to one brand owner. Pick one at the top left." })
    ] }) });
  }
  if (result && result.kind !== "ok") return /* @__PURE__ */ jsxRuntimeExports.jsx(Unavailable, { kind: result.kind });
  if (!loaded || !draft || pack == null) return /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "screen" });
  const touch = () => {
    setChecked(false);
    setProblem(null);
    setSaved(null);
  };
  const edit = (spec, raw) => {
    setDraft((d) => applyField(d ?? {}, spec, raw));
    setEdits((e) => ({ ...e, [spec.key]: raw }));
    touch();
  };
  const editPack = (raw) => {
    setPack(raw);
    touch();
  };
  const send = async (action) => {
    setBusy(true);
    setProblem(null);
    const r = await api.saveProfile(account, action, {
      profile: stripCodeOwned(draft),
      contextPack: pack
    });
    setBusy(false);
    if (!isOk(r)) {
      setChecked(false);
      setProblem(explain(r));
      return;
    }
    if (action === "validate") {
      setChecked(true);
      return;
    }
    setChecked(false);
    const uncommitted = notCommitted(r);
    if (uncommitted) setProblem({ title: "Saved, but not committed", lines: [uncommitted] });
    setSaved({ at: Date.now(), sha: typeof r.value["sha"] === "string" ? r.value["sha"] : null });
    reload();
  };
  return /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "screen", children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "measure", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "notice quiet", style: { margin: "0 0 18px" }, children: /* @__PURE__ */ jsxRuntimeExports.jsx("p", { style: { margin: 0, color: "var(--text-muted)", fontSize: 13 }, children: "These settings scope every clearance for this brand owner. Changes are checked against the same rules the search engine applies when it starts a run, and each save is recorded against your sign-in." }) }),
    /* @__PURE__ */ jsxRuntimeExports.jsx(FrameworkBlock, { readOnly: loaded.readOnly, framework: loaded.framework, staff: ctx.me.role === "staff" }),
    FIELD_GROUPS.map((group) => {
      const specs = PROFILE_FIELDS.filter((s) => s.group === group.id);
      if (!specs.length) return null;
      return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { marginTop: 26 }, children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "eyebrow", children: group.label }),
        specs.map((spec) => /* @__PURE__ */ jsxRuntimeExports.jsx(
          Field,
          {
            spec,
            value: boxValue({ draft, edits }, spec),
            choices: spec.key === "defaultProduct" ? productChoices : spec.choices ?? null,
            onChange: (v) => edit(spec, v)
          },
          spec.key
        )),
        group.id === "defaults" ? /* @__PURE__ */ jsxRuntimeExports.jsx(CoverageNote, { derived: loaded.derived }) : null
      ] }, group.id);
    }),
    /* @__PURE__ */ jsxRuntimeExports.jsx(
      ContextPackEditor,
      {
        value: pack,
        onChange: editPack,
        title: "Background & standing concerns",
        hint: "Useful background about this brand owner — competitors to watch, recurring concerns, lessons from past matters. Every clearance reads it before it writes. Facts and concerns, not rules: it shapes what a report emphasises, never what a finding is rated."
      }
    ),
    problem ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "notice", style: { borderColor: "var(--tone-high)", marginTop: 18 }, children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("b", { children: problem.title }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("ul", { style: { margin: "8px 0 0", paddingLeft: 18, color: "var(--text-muted)" }, children: problem.lines.map((l, i) => /* @__PURE__ */ jsxRuntimeExports.jsx("li", { style: { marginBottom: 3 }, children: l }, i)) })
    ] }) : null,
    saved ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "notice", style: { borderColor: "var(--tone-minimal)", marginTop: 18 }, children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("b", { children: "Saved" }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { style: { margin: "6px 0 0", color: "var(--text-muted)", fontSize: 13 }, children: [
        "Recorded against your sign-in",
        saved.sha ? /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
          " · ",
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "mono", children: saved.sha.slice(0, 8) })
        ] }) : null,
        "."
      ] })
    ] }) : null,
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { marginTop: 22, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }, children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx(
        "button",
        {
          type: "button",
          className: "pill",
          disabled: busy || !dirty,
          onClick: () => send("validate"),
          style: { padding: "9px 16px", cursor: busy || !dirty ? "not-allowed" : "pointer", opacity: busy || !dirty ? 0.5 : 1 },
          children: busy ? "Checking…" : "Check"
        }
      ),
      /* @__PURE__ */ jsxRuntimeExports.jsx(
        "button",
        {
          type: "button",
          className: "pill",
          disabled: busy || !dirty || !checked,
          onClick: () => send("save"),
          style: {
            padding: "9px 16px",
            cursor: busy || !dirty || !checked ? "not-allowed" : "pointer",
            opacity: busy || !dirty || !checked ? 0.5 : 1,
            background: "var(--accent-wash)",
            borderColor: "var(--accent)",
            color: "var(--text-accent)"
          },
          children: "Save"
        }
      ),
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { fontSize: 12.5, color: "var(--text-muted)" }, children: !dirty ? "No changes." : checked ? "Checked — safe to save." : "Check first. A profile the engine cannot read stops this account searching." })
    ] })
  ] }) });
}
function CoverageNote({ derived }) {
  const batch = derived == null ? void 0 : derived["batchSize"];
  const cells = derived == null ? void 0 : derived["minCellsPerVariant"];
  if (typeof batch !== "number" || typeof cells !== "number") return null;
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { style: { margin: "14px 0 0", fontSize: 12.5, color: "var(--text-muted)" }, children: [
    "Calculated from the marketplaces and density above: about ",
    /* @__PURE__ */ jsxRuntimeExports.jsx("b", { children: batch }),
    " search variant",
    batch === 1 ? "" : "s",
    " per pass across ",
    /* @__PURE__ */ jsxRuntimeExports.jsx("b", { children: cells }),
    " sources."
  ] });
}
const str = (v) => typeof v === "string" && v.trim() !== "" ? v : null;
const arr = (v) => Array.isArray(v) ? v : [];
const rec = (v) => typeof v === "object" && v !== null && !Array.isArray(v) ? v : null;
const TONE = {
  severe: "var(--tone-severe)",
  high: "var(--tone-high)",
  medium: "var(--tone-medium)",
  low: "var(--tone-low)",
  minimal: "var(--tone-minimal)"
};
function BandPill({ label, tone }) {
  return /* @__PURE__ */ jsxRuntimeExports.jsx(
    "span",
    {
      className: "pill",
      style: {
        padding: "2px 10px",
        borderRadius: 999,
        background: TONE[String(tone)] ?? "var(--text-muted)",
        borderColor: "transparent",
        color: "#fff",
        fontSize: 11,
        fontWeight: 700,
        whiteSpace: "nowrap"
      },
      children: label
    }
  );
}
function FrameworkBlock({
  readOnly,
  framework,
  staff
}) {
  const entries = visibleReadOnlyFields(readOnly, staff);
  const fw = framework ?? {};
  const manifest = rec(fw["manifest"]);
  const title = str(manifest == null ? void 0 : manifest["title"]);
  const custom = fw["custom"] === true;
  const bands = arr(manifest == null ? void 0 : manifest["bands"]);
  const meanings = arr(fw["bandMeanings"]);
  const structure = rec(manifest == null ? void 0 : manifest["structure"]);
  const axes = arr(structure == null ? void 0 : structure["axes"]).map(String).filter(Boolean);
  const entity = str(manifest == null ? void 0 : manifest["entity_label"]);
  const displayNote = str(structure == null ? void 0 : structure["display_note"]);
  const examples = fw["hasWorkedExamples"] === true;
  const toneOf = (band) => {
    var _a;
    return (_a = rec(bands.find((b) => {
      var _a2;
      return ((_a2 = rec(b)) == null ? void 0 : _a2["label"]) === band;
    }))) == null ? void 0 : _a["tone"];
  };
  if (!entries.length && !title && !examples && !framework) return null;
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "notice quiet", style: { marginBottom: 8 }, children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "fw-sectionh", children: "Risk framework in force" }),
    /* @__PURE__ */ jsxRuntimeExports.jsx(
      "div",
      {
        className: "fw-ro",
        style: custom && !title ? { borderColor: "var(--tone-high)" } : void 0,
        children: custom && title ? /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs("b", { children: [
            "Custom framework: ",
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { "data-anon": "mark", children: title })
          ] }),
          " ",
          "— this brand owner’s own framework rates every matter for them, in its own words."
        ] }) : custom ? /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("b", { style: { color: "var(--tone-high)" }, children: "This account’s framework could not be read." }),
          " ",
          "A custom framework is on file for this brand owner, so their matters are ",
          /* @__PURE__ */ jsxRuntimeExports.jsx("b", { children: "not" }),
          " rated under the Generic default — but its definitions are unavailable, so the bands cannot be shown here. This needs an administrator to look at it."
        ] }) : /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("b", { children: "Generic default" }),
          " — no custom framework is on file for this brand owner; their matters are rated under the generic framework."
        ] })
      }
    ),
    bands.length ? /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "fw-ladder", children: bands.map((b, i) => {
      const band = rec(b);
      const label = str(band == null ? void 0 : band["label"]);
      return label ? /* @__PURE__ */ jsxRuntimeExports.jsx(BandPill, { label, tone: band == null ? void 0 : band["tone"] }, i) : null;
    }) }) : null,
    meanings.length ? /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "fw-bmh", children: "What the bands mean" }),
      meanings.map((m, i) => {
        const row = rec(m);
        const band = str(row == null ? void 0 : row["band"]);
        const meaning = str(row == null ? void 0 : row["meaning"]);
        if (!band || !meaning) return null;
        const response = str(row == null ? void 0 : row["response"]);
        const rungs = Array.isArray(row == null ? void 0 : row["rungs"]) ? row["rungs"].map(rec).filter((r) => r !== null) : [];
        return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "fw-bmrow", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(BandPill, { label: band, tone: toneOf(band) }),
          rungs.length ? (
            /* Every lifted line is data-anon="mark" — the decks are Privileged & Confidential and
               the demo blur has to cover the label as well as the prose, or a rung name survives
               a blur that hides its text. */
            /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "fw-bmrungs", children: rungs.map((r, j) => {
              const label = str(r["label"]);
              const text = str(r["text"]);
              if (!label || !text) return null;
              return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "fw-bmrung", "data-anon": "mark", children: [
                /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "fw-bmrunglbl", children: label }),
                /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "fw-bmtxt", children: text })
              ] }, j);
            }) })
          ) : /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "fw-bmtxt", "data-anon": "mark", children: [
            meaning,
            response ? /* @__PURE__ */ jsxRuntimeExports.jsxs("i", { className: "fw-bmresp", children: [
              " — ",
              response
            ] }) : null
          ] })
        ] }, i);
      })
    ] }) : null,
    axes.length ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "fw-meta", style: { marginTop: 14 }, children: [
      "Rated on: ",
      /* @__PURE__ */ jsxRuntimeExports.jsx("b", { children: axes.join(" × ") })
    ] }) : null,
    entity ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "fw-meta", children: [
      "Entity in prose: ",
      /* @__PURE__ */ jsxRuntimeExports.jsx("b", { "data-anon": "mark", children: entity }),
      (structure == null ? void 0 : structure["kind"]) === "matrix" ? /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
        " · matrix-shaped",
        displayNote ? ` — ${displayNote}` : ""
      ] }) : null
    ] }) : null,
    examples || entries.length ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { marginTop: 20, borderTop: "1px solid var(--border-hairline)", paddingTop: 14 }, children: [
      examples ? /* @__PURE__ */ jsxRuntimeExports.jsx(Row$2, { label: "Worked examples", value: "Used when rating this account" }) : null,
      entries.map((k) => /* @__PURE__ */ jsxRuntimeExports.jsx(Row$2, { label: LABELS[k] ?? k, value: render(readOnly[k]) }, k))
    ] }) : null
  ] });
}
const LABELS = {
  frameworkPath: "Rating framework",
  workedExamplesPath: "Worked examples",
  allowedRecipes: "Permitted searches",
  jxPolicy: "Jurisdiction policy",
  runCaps: "Run limits"
};
const render = (v) => {
  if (v == null) return "—";
  if (Array.isArray(v)) return v.length ? v.map(String).join(", ") : "—";
  if (typeof v === "object") {
    return Object.entries(v).map(([k, val]) => `${k}: ${String(val)}`).join(" · ");
  }
  return String(v);
};
function Row$2({ label, value }) {
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { display: "flex", gap: 14, padding: "5px 0", fontSize: 13, alignItems: "baseline" }, children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { color: "var(--text-muted)", minWidth: 150 }, children: label }),
    /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { color: "var(--text-strong)", wordBreak: "break-word" }, children: value })
  ] });
}
function Field({
  spec,
  value,
  choices,
  onChange
}) {
  const picker = spec.kind === "choice" || spec.kind === "boolean";
  const multi = spec.kind === "lines" || spec.kind === "prose";
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("label", { style: { display: "block", marginTop: 18 }, children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { fontWeight: 700, color: "var(--text-strong)", fontSize: 14 }, children: spec.label }),
    spec.hint ? /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { fontSize: 12.5, color: "var(--text-muted)", margin: "2px 0 7px" }, children: spec.hint }) : /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { height: 7 } }),
    picker && (choices == null ? void 0 : choices.length) ? /* @__PURE__ */ jsxRuntimeExports.jsxs("select", { value, onChange: (e) => onChange(e.target.value), style: inputStyle$1, children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("option", { value: "", children: spec.clearedLabel ?? CLEARED_LABEL }),
      choices.map((c) => /* @__PURE__ */ jsxRuntimeExports.jsx("option", { value: c.value, children: c.label }, c.value))
    ] }) : picker ? (
      // Options unavailable: show what is set, as text. An empty dropdown would invite a person to
      // open it, find nothing, and conclude the setting is broken — and if they did manage to pick
      // the blank, they would clear a setting they only came to read. Same reasoning as the
      // NewClearance failure branch.
      //
      // What is NOT printed here is the raw stored value. For defaultProduct that is a registry
      // key (`prelim-jx`, `knockout-register`) whose display face is `stageLabel` — and this screen
      // is client-reachable, so the key is internal vocabulary leaking to a client. The labels
      // arrive over the wire with the options, so on the degraded path there is nothing to resolve
      // it against; say a value is set and say why its name is missing.
      /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { ...inputStyle$1, color: value ? "var(--text-strong)" : "var(--text-muted)" }, children: value ? choiceLabel(spec, value) ?? "Set — the options could not be loaded just now" : spec.clearedLabel ?? CLEARED_LABEL })
    ) : multi ? /* @__PURE__ */ jsxRuntimeExports.jsx("textarea", { value, onChange: (e) => onChange(e.target.value), rows: spec.kind === "prose" ? 5 : 3, style: inputStyle$1 }) : /* @__PURE__ */ jsxRuntimeExports.jsx("input", { value, onChange: (e) => onChange(e.target.value), style: inputStyle$1 }),
    /* @__PURE__ */ jsxRuntimeExports.jsx(FieldNotices, { notices: fieldNotices(spec, value) }),
    /* @__PURE__ */ jsxRuntimeExports.jsx(FieldPicker, { spec, value, onChange })
  ] });
}
function Unavailable({ kind }) {
  return /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "screen", children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "empty", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx(Icon, { name: "alert", size: 20 }),
    /* @__PURE__ */ jsxRuntimeExports.jsx("p", { children: kind === "surfaceUnavailable" ? "The settings surface is not configured on this deployment. This is a server setting, not your access — an administrator needs to point it at the customer store." : kind === "notFound" ? "These settings are not available to you." : "The settings could not be loaded just now." })
  ] }) });
}
function explain(r) {
  switch (r.kind) {
    case "reject":
    case "collision":
      return { title: "That cannot be saved as written", lines: r.errors ?? ["The change was refused."] };
    case "clarify":
      return { title: "Something needs answering first", lines: r.questions ?? [] };
    case "conflict":
      return { title: "Someone else changed this first", lines: [r.message ?? "Reload and reapply your change."] };
    case "notFound":
      return { title: "That is not available to you", lines: ["Check the brand owner selected at the top left."] };
    // SPLIT FROM `notFound`. They are different answers and only one of them has
    // anything to do with the selector. `notFound` may well BE the wrong brand owner, so that advice is
    // right there. `noAccess` is the door refusing the identity itself — reachable only for door checks,
    // never for anything tenant-scoped — and telling that person to check the selector sends them to the
    // one thing that is not wrong. Someone who signs in successfully and can do nothing should be told
    // why on the page, not in a boot log nobody reads.
    //
    // The words are the ones portal-service already logs at boot: on no staff domain, in no grants row.
    // Nothing here is tenant-scoped, so it leaks nothing the 404-never-403 rule protects — it is a fact
    // about the caller's own identity, and it is the only fact that helps them.
    case "noAccess":
      return {
        title: "This address has no access yet",
        lines: ["You are signed in, but this address is on no staff domain and in no grants row, so every page refuses it. Selecting a different brand owner cannot change that — an administrator needs to add it to one."]
      };
    case "surfaceUnavailable":
      return {
        title: "The settings surface is not configured here",
        lines: ["Nothing was written. This is a server setting on this deployment, not your access — an administrator needs to point it at the customer store."]
      };
    case "rateLimited":
      return { title: "Too many requests just now", lines: ["Wait a moment and try again."] };
    default:
      return { title: "The change was not saved", lines: [r.message ?? "Nothing was written. Try again shortly."] };
  }
}
const inputStyle$1 = {
  width: "100%",
  padding: "9px 11px",
  borderRadius: 9,
  border: "1px solid var(--border-hairline)",
  background: "var(--surface-raised)",
  color: "var(--text-strong)",
  fontFamily: "inherit",
  fontSize: 14,
  resize: "vertical"
};
function Projects({ ctx }) {
  const account = ctx.owner;
  const needsOwner = ctx.me.allAccounts && account === null;
  const [open, setOpen] = reactExports.useState(
    () => new URLSearchParams(window.location.search).get("project") || null
  );
  const [creating, setCreating] = reactExports.useState(false);
  const [rowBusy, setRowBusy] = reactExports.useState(null);
  const [confirming, setConfirming] = reactExports.useState(null);
  const [rowProblem, setRowProblem] = reactExports.useState(null);
  const { result, reload } = useLoad(() => api.projects(account), [account]);
  const projects = (result == null ? void 0 : result.kind) === "ok" ? result.value : [];
  if (needsOwner || (result == null ? void 0 : result.kind) === "pickAccount") {
    return /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "screen", children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "notice", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("b", { children: "Choose a brand owner first" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("p", { style: { margin: "6px 0 0", color: "var(--text-muted)" }, children: "Projects belong to one brand owner. Pick one at the top left." })
    ] }) });
  }
  if (result && result.kind !== "ok") {
    return /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "screen", children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "empty", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx(Icon, { name: "alert", size: 20 }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("p", { children: result.kind === "surfaceUnavailable" ? "The settings surface is not configured on this deployment. This is a server setting, not your access — an administrator needs to point it at the customer store." : result.kind === "notFound" ? "Projects are not available to you." : "Projects could not be loaded just now." })
    ] }) });
  }
  if (!result) return /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "screen" });
  if (open) return /* @__PURE__ */ jsxRuntimeExports.jsx(ProjectEditor, { account, project: open, onBack: () => {
    setOpen(null);
    reload();
  } });
  if (creating) {
    return /* @__PURE__ */ jsxRuntimeExports.jsx(
      NewProject,
      {
        account,
        taken: projects.map((p) => p.key),
        onDone: (key) => {
          setCreating(false);
          reload();
          setOpen(key);
        },
        onCancel: () => setCreating(false)
      }
    );
  }
  const setArchived = async (key, archived) => {
    setRowBusy(key);
    setRowProblem(null);
    const detail = await api.project(account, key);
    if (!isOk(detail)) {
      setRowBusy(null);
      setRowProblem(saveFailureText(detail, "That project could not be opened just now. Nothing has been changed."));
      return;
    }
    const r = await api.saveProject(account, key, "save", {
      // Explicit either way. The server keeps archive state sticky against omission, so only an
      // explicit false brings a project back.
      profile: stripCodeOwned({ ...detail.value.overlay, archived }),
      contextPack: detail.value.contextPack
    });
    setRowBusy(null);
    setConfirming(null);
    if (!isOk(r)) {
      setRowProblem(saveFailureText(r, `That project could not be ${archived ? "archived" : "brought back"}. Nothing has been changed.`));
      return;
    }
    const uncommittedRow = notCommitted(r);
    if (uncommittedRow) setRowProblem(uncommittedRow);
    reload();
  };
  return /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "screen", children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "measure", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "notice quiet", style: { marginBottom: 18 }, children: /* @__PURE__ */ jsxRuntimeExports.jsx("p", { style: { margin: 0, color: "var(--text-muted)", fontSize: 13 }, children: "A project runs a distinct engagement with its own defaults — different marketplaces, classes or depth — while keeping the brand owner’s identity and rating. Anything a project does not set is inherited." }) }),
    rowProblem ? /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "notice", style: { borderColor: "var(--tone-high)", marginBottom: 18 }, children: /* @__PURE__ */ jsxRuntimeExports.jsx("b", { children: rowProblem }) }) : null,
    /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { display: "flex", justifyContent: "flex-end", marginBottom: 10 }, children: /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "pill", style: { cursor: "pointer" }, onClick: () => setCreating(true), children: "New project" }) }),
    projects.length === 0 ? (
      // "No projects FOR THIS BRAND OWNER", deliberately not "no projects exist" — the phrasing
      // survives from when archived projects were hidden from clients entirely, and it stays right
      // for a different reason now: this list is one brand owner's, not the instance's.
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "empty", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { children: "No projects for this brand owner. Every clearance uses their own defaults." }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { style: { fontSize: 13, color: "var(--text-muted)" }, children: "Add one when an engagement needs its own marketplaces, classes or depth. Archive it when it ends — the reports it produced stay exactly as issued." }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { marginTop: 12 }, children: /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "pill", style: { cursor: "pointer" }, onClick: () => setCreating(true), children: "New project" }) })
      ] })
    ) : /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { display: "grid", gap: 8 }, children: projects.map((p) => /* @__PURE__ */ jsxRuntimeExports.jsxs(
      "div",
      {
        style: {
          padding: "12px 14px",
          borderRadius: 10,
          border: "1px solid var(--border-hairline)",
          background: "var(--surface-raised)",
          display: "flex",
          alignItems: "center",
          gap: 12,
          // An archived project is SHOWN, greyed and badged — not hidden. It stays openable so
          // its settings can be read and so it can be brought back; hiding it is what would make
          // archiving a one-way door for whoever archived it.
          opacity: p.archived ? 0.55 : 1
        },
        children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs(
            "button",
            {
              type: "button",
              onClick: () => setOpen(p.key),
              style: {
                flex: 1,
                textAlign: "left",
                background: "none",
                border: 0,
                padding: 0,
                cursor: "pointer",
                font: "inherit",
                color: "inherit",
                minWidth: 0
              },
              children: [
                /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { display: "flex", alignItems: "baseline", gap: 8 }, children: [
                  /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { fontWeight: 700, color: "var(--text-strong)" }, "data-anon": "mark", children: p.name || p.key }),
                  p.archived ? /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "pill", style: { fontSize: 10.5, padding: "1px 7px" }, children: "Archived" }) : null
                ] }),
                /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "mono", style: { fontSize: 12, color: "var(--text-muted)" }, children: p.key })
              ]
            }
          ),
          confirming === p.key ? /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(
              "button",
              {
                type: "button",
                className: "pill",
                style: { cursor: "pointer", fontSize: 12, borderColor: "var(--tone-high)" },
                disabled: rowBusy === p.key,
                onClick: () => void setArchived(p.key, true),
                children: rowBusy === p.key ? "Working…" : "Confirm — archive"
              }
            ),
            /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "pill", style: { cursor: "pointer", fontSize: 12 }, onClick: () => setConfirming(null), children: "Cancel" })
          ] }) : /* @__PURE__ */ jsxRuntimeExports.jsx(
            "button",
            {
              type: "button",
              className: "pill",
              style: { cursor: "pointer", fontSize: 12 },
              disabled: rowBusy === p.key,
              onClick: () => p.archived ? void setArchived(p.key, false) : setConfirming(p.key),
              children: rowBusy === p.key ? "Working…" : p.archived ? "Bring back" : "Archive"
            }
          ),
          /* @__PURE__ */ jsxRuntimeExports.jsx(Icon, { name: "chevron", size: 16 })
        ]
      },
      p.key
    )) })
  ] }) });
}
function NewProject({
  account,
  taken,
  onDone,
  onCancel
}) {
  const [name, setName] = reactExports.useState("");
  const [key, setKey] = reactExports.useState("");
  const [touchedKey, setTouchedKey] = reactExports.useState(false);
  const [busy, setBusy] = reactExports.useState(false);
  const [problem, setProblem] = reactExports.useState(null);
  const slug = (touchedKey ? key : name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 39);
  const keyProblem = slug.length < 2 ? "The key needs at least two letters or numbers." : taken.includes(slug) ? "This brand owner already has a project with that key." : null;
  const create = async () => {
    setBusy(true);
    setProblem(null);
    const body = { profile: { projectName: name.trim() }, contextPack: "" };
    const check = await api.saveProject(account, slug, "validate", body);
    if (!isOk(check) || check.value.ok === false) {
      setBusy(false);
      const errors = isOk(check) ? check.value.errors : "errors" in check && Array.isArray(check.errors) ? check.errors : void 0;
      setProblem((errors == null ? void 0 : errors.length) ? errors : ["That project could not be created as written."]);
      return;
    }
    const r = await api.saveProject(account, slug, "save", body);
    setBusy(false);
    if (!isOk(r)) {
      setProblem("errors" in r && Array.isArray(r.errors) && r.errors.length ? r.errors : [saveFailureText(r, "That project could not be created.")]);
      return;
    }
    const uncommittedNew = notCommitted(r);
    if (uncommittedNew) {
      setProblem([uncommittedNew]);
      return;
    }
    onDone(slug);
  };
  return /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "screen", children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "measure", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }, children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("button", { type: "button", className: "nav-item", style: { width: "auto", padding: "4px 8px", margin: 0 }, onClick: onCancel, children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(Icon, { name: "chevron-left", size: 14 }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "Projects" })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "crumb", children: "›" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "crumb", children: "New project" })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "notice quiet", style: { marginBottom: 18 }, children: /* @__PURE__ */ jsxRuntimeExports.jsx("p", { style: { margin: 0, color: "var(--text-muted)", fontSize: 13 }, children: "Name it — the next screen sets what this engagement runs differently, and anything you leave alone is inherited from the brand owner." }) }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("label", { style: { display: "block" }, children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { fontWeight: 700, color: "var(--text-strong)", fontSize: 14 }, children: "Project name" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { fontSize: 12.5, color: "var(--text-muted)", margin: "2px 0 7px" }, children: "How it appears when a clearance is set up. Can be changed later." }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("input", { value: name, onChange: (e) => setName(e.target.value), placeholder: "EU launch 2027", "data-anon": "mark", style: inputStyle })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("details", { style: { marginTop: 16 }, children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("summary", { style: { cursor: "pointer", fontSize: 12.5, color: "var(--text-muted)" }, children: [
        "Filed as ",
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "mono", style: { color: "var(--text-body)" }, children: slug || "—" })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { fontSize: 12.5, color: "var(--text-muted)", margin: "9px 0 7px" }, children: "Reference on every run. Fixed once created." }),
      /* @__PURE__ */ jsxRuntimeExports.jsx(
        "input",
        {
          value: touchedKey ? key : slug,
          onChange: (e) => {
            setTouchedKey(true);
            setKey(e.target.value);
          },
          placeholder: "eu-launch-2027",
          className: "mono",
          "aria-label": "Project reference",
          style: inputStyle
        }
      ),
      keyProblem && (name || key) ? /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { fontSize: 12.5, color: "var(--tone-high)", marginTop: 5 }, children: keyProblem }) : null
    ] }),
    problem ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "notice", style: { borderColor: "var(--tone-high)", marginTop: 18 }, children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("b", { children: "That project could not be created" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("ul", { style: { margin: "8px 0 0", paddingLeft: 18, color: "var(--text-muted)" }, children: problem.map((l, i) => /* @__PURE__ */ jsxRuntimeExports.jsx("li", { style: { marginBottom: 3 }, children: l }, i)) })
    ] }) : null,
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { marginTop: 22, display: "flex", gap: 10, alignItems: "center" }, children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx(
        "button",
        {
          type: "button",
          className: "pill",
          disabled: busy || keyProblem !== null || name.trim() === "",
          onClick: () => void create(),
          style: {
            padding: "9px 16px",
            cursor: busy || keyProblem || !name.trim() ? "not-allowed" : "pointer",
            opacity: busy || keyProblem || !name.trim() ? 0.5 : 1,
            background: "var(--accent-wash)",
            borderColor: "var(--accent)",
            color: "var(--text-accent)"
          },
          children: busy ? "Creating…" : "Create project"
        }
      ),
      /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "pill", style: { padding: "9px 16px", cursor: "pointer" }, onClick: onCancel, children: "Cancel" })
    ] })
  ] }) });
}
function ProjectEditor({
  account,
  project,
  onBack
}) {
  const { result, reload } = useLoad(() => api.project(account, project), [account, project]);
  const detail = (result == null ? void 0 : result.kind) === "ok" ? result.value : null;
  const [draft, setDraft] = reactExports.useState(null);
  const [pack, setPack] = reactExports.useState(null);
  const [busy, setBusy] = reactExports.useState(false);
  const [edits, setEdits] = reactExports.useState({});
  const [checked, setChecked] = reactExports.useState(false);
  const [saved, setSaved] = reactExports.useState(false);
  const [confirmArchive, setConfirmArchive] = reactExports.useState(false);
  const [problem, setProblem] = reactExports.useState(null);
  reactExports.useEffect(() => {
    if (detail) {
      setDraft(detail.overlay);
      setPack(detail.contextPack);
      setEdits({});
    }
  }, [detail]);
  const fields = projectFields();
  const wouldRevoke = reactExports.useMemo(() => {
    if (!detail || !draft) return [];
    const customer = detail.inherited["platforms"];
    if (!("platforms" in draft)) return [];
    return revokedPlatforms(
      Array.isArray(customer) ? customer : [],
      Array.isArray(draft["platforms"]) ? draft["platforms"] : []
    );
  }, [detail, draft]);
  const dirty = reactExports.useMemo(
    () => draft != null && detail != null && (JSON.stringify(draft) !== JSON.stringify(detail.overlay) || pack != null && pack !== detail.contextPack),
    [draft, pack, detail]
  );
  useUnsaved(dirty);
  if (result && result.kind !== "ok") {
    return /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "screen", children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "empty", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("p", { children: "That project is not available." }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "nav-item", style: { width: "auto", margin: "0 auto" }, onClick: onBack, children: "Back to Projects" })
    ] }) });
  }
  if (!detail || !draft) return /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "screen" });
  const edit = (spec, raw) => {
    setDraft((d) => applyField(d ?? {}, spec, raw));
    setEdits((e) => ({ ...e, [spec.key]: raw }));
    setChecked(false);
    setProblem(null);
    setSaved(false);
  };
  const send = async (action) => {
    if (wouldRevoke.length) return;
    setBusy(true);
    setProblem(null);
    const r = await api.saveProject(account, project, action, {
      profile: stripCodeOwned(draft),
      contextPack: pack ?? detail.contextPack
    });
    setBusy(false);
    if (!isOk(r)) {
      setChecked(false);
      setProblem({
        title: "That cannot be saved as written",
        // `errors` alone reaches two members of the union and drops the reason on the rest — a 404
        // saying the project has gone, a 409 from the store, a session that ended mid-edit.
        lines: "errors" in r && Array.isArray(r.errors) && r.errors.length ? r.errors : [saveFailureText(r, "The change was refused.")]
      });
      return;
    }
    if (action === "validate") {
      setChecked(true);
      return;
    }
    setChecked(false);
    const uncommittedEdit = notCommitted(r);
    if (uncommittedEdit) setProblem({ title: "Saved, but not committed", lines: [uncommittedEdit] });
    setSaved(true);
    reload();
  };
  const isArchived = (draft == null ? void 0 : draft["archived"]) === true;
  const toggleArchive = async () => {
    if (!detail || !draft) return;
    if (wouldRevoke.length) return;
    setBusy(true);
    setProblem(null);
    const r = await api.saveProject(account, project, "save", {
      profile: stripCodeOwned({ ...draft, archived: !isArchived }),
      // Archiving must not silently revert an unsaved pack edit, for the same reason it must not commit
      // one the Save button is refusing: it posts the whole pending draft.
      contextPack: pack ?? detail.contextPack
    });
    setBusy(false);
    setConfirmArchive(false);
    if (!isOk(r)) {
      setProblem({
        title: isArchived ? "That could not be un-archived" : "That could not be archived",
        // `errors` alone reaches two members of the union and drops the reason on the rest — a 404
        // saying the project has gone, a 409 from the store, a session that ended mid-edit.
        lines: "errors" in r && Array.isArray(r.errors) && r.errors.length ? r.errors : [saveFailureText(r, "The change was refused.")]
      });
      return;
    }
    const uncommittedArchive = notCommitted(r);
    if (uncommittedArchive) setProblem({ title: "Saved, but not committed", lines: [uncommittedArchive] });
    setChecked(false);
    setSaved(true);
    reload();
  };
  return /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "screen", children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "measure", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }, children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("button", { type: "button", className: "nav-item", style: { width: "auto", padding: "4px 8px", margin: 0 }, onClick: onBack, children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(Icon, { name: "chevron-left", size: 14 }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "Projects" })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "crumb", children: "›" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "crumb", "data-anon": "mark", children: detail.project })
    ] }),
    isArchived ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "notice", style: { marginBottom: 18 }, children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("b", { children: "This project is archived" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("p", { style: { margin: "6px 0 0", color: "var(--text-muted)", fontSize: 13 }, children: "It is no longer offered when a new clearance is set up, and the reports it produced are unchanged. Its settings can still be edited, and it can be un-archived below." })
    ] }) : null,
    /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "notice quiet", style: { marginBottom: 18 }, children: /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { style: { margin: 0, color: "var(--text-muted)", fontSize: 13 }, children: [
      "Anything left blank is inherited from ",
      detail.customerName || detail.customer,
      ". Identity and rating stay with the brand owner and are not set here."
    ] }) }),
    fields.map((spec) => /* @__PURE__ */ jsxRuntimeExports.jsx(
      OverlayField,
      {
        spec,
        value: boxValue({ draft, edits }, spec),
        inherited: fieldInput(detail.inherited, spec),
        set: isSet(draft, spec),
        onChange: (v) => edit(spec, v)
      },
      spec.key
    )),
    /* @__PURE__ */ jsxRuntimeExports.jsx(
      ContextPackEditor,
      {
        value: pack ?? "",
        onChange: (v) => {
          setPack(v);
          setChecked(false);
          setSaved(false);
        },
        title: "Project background & concerns",
        hint: "What this engagement covers and the concerns particular to it. Replaces the brand owner's background when set — it is not added to it.",
        rows: 6
      }
    ),
    wouldRevoke.length ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "notice", style: { borderColor: "var(--tone-high)", marginTop: 18 }, children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("b", { children: "This would remove a marketplace the brand owner requires" }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { style: { margin: "6px 0 0", color: "var(--text-muted)", fontSize: 13 }, children: [
        "A project can add marketplaces, never drop one. Put ",
        wouldRevoke.length === 1 ? "this back" : "these back",
        " to save: ",
        /* @__PURE__ */ jsxRuntimeExports.jsx("b", { children: wouldRevoke.join(", ") }),
        ", or empty the box to inherit the list unchanged."
      ] })
    ] }) : null,
    problem ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "notice", style: { borderColor: "var(--tone-high)", marginTop: 18 }, children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("b", { children: problem.title }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("ul", { style: { margin: "8px 0 0", paddingLeft: 18, color: "var(--text-muted)" }, children: problem.lines.map((l, i) => /* @__PURE__ */ jsxRuntimeExports.jsx("li", { style: { marginBottom: 3 }, children: l }, i)) })
    ] }) : null,
    saved ? /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "notice", style: { borderColor: "var(--tone-minimal)", marginTop: 18 }, children: /* @__PURE__ */ jsxRuntimeExports.jsx("b", { children: "Saved" }) }) : null,
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { marginTop: 22, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }, children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx(
        "button",
        {
          type: "button",
          className: "pill",
          disabled: busy || !dirty || wouldRevoke.length > 0,
          onClick: () => send("validate"),
          style: { padding: "9px 16px", cursor: busy || !dirty || wouldRevoke.length ? "not-allowed" : "pointer", opacity: busy || !dirty || wouldRevoke.length ? 0.5 : 1 },
          children: busy ? "Checking…" : "Check"
        }
      ),
      /* @__PURE__ */ jsxRuntimeExports.jsx(
        "button",
        {
          type: "button",
          className: "pill",
          disabled: busy || !dirty || !checked || wouldRevoke.length > 0,
          onClick: () => send("save"),
          style: {
            padding: "9px 16px",
            cursor: busy || !dirty || !checked || wouldRevoke.length ? "not-allowed" : "pointer",
            opacity: busy || !dirty || !checked || wouldRevoke.length ? 0.5 : 1,
            background: "var(--accent-wash)",
            borderColor: "var(--accent)",
            color: "var(--text-accent)"
          },
          children: "Save"
        }
      )
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { marginTop: 26, paddingTop: 18, borderTop: "1px solid var(--border-hairline)" }, children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { fontWeight: 700, color: "var(--text-strong)", fontSize: 14 }, children: isArchived ? "Un-archive this project" : "Archive this project" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "prose", style: { margin: "5px 0 10px", color: "var(--text-muted)", fontSize: 13 }, children: isArchived ? "It will be offered again when a new clearance is set up." : "Nothing is deleted: it stops being offered for new clearances, the reports it already produced are unaffected, and it can be un-archived at any time." }),
      /* @__PURE__ */ jsxRuntimeExports.jsx(
        "button",
        {
          type: "button",
          className: "pill",
          disabled: busy,
          onClick: () => confirmArchive ? void toggleArchive() : setConfirmArchive(true),
          style: {
            padding: "9px 16px",
            cursor: busy ? "not-allowed" : "pointer",
            opacity: busy ? 0.5 : 1,
            ...confirmArchive ? { borderColor: "var(--tone-high)", color: "var(--text-strong)" } : {}
          },
          children: busy ? "Working…" : confirmArchive ? isArchived ? "Confirm — un-archive" : "Confirm — archive" : isArchived ? "Un-archive project" : "Archive project"
        }
      ),
      confirmArchive && !busy ? /* @__PURE__ */ jsxRuntimeExports.jsx(
        "button",
        {
          type: "button",
          className: "pill",
          onClick: () => setConfirmArchive(false),
          style: { padding: "9px 16px", marginLeft: 8, cursor: "pointer" },
          children: "Cancel"
        }
      ) : null
    ] })
  ] }) });
}
function summarise(value, max = 90) {
  const flat = value.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const stop = flat.slice(0, max).lastIndexOf(". ");
  if (stop > 30) return flat.slice(0, stop + 1);
  const cut = flat.slice(0, max).lastIndexOf(" ");
  return `${flat.slice(0, cut > 30 ? cut : max)}… (${flat.length.toLocaleString()} characters)`;
}
function OverlayField({
  spec,
  value,
  inherited: inherited2,
  set,
  onChange
}) {
  const picker = spec.kind === "choice" || spec.kind === "boolean";
  const multi = spec.kind === "lines" || spec.kind === "prose";
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("label", { style: { display: "block", marginTop: 18 }, children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { display: "flex", alignItems: "baseline", gap: 8 }, children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { fontWeight: 700, color: "var(--text-strong)", fontSize: 14 }, children: spec.label }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "pill", style: { fontSize: 10.5, padding: "1px 7px" }, children: set ? "This project" : "Inherited" })
    ] }),
    spec.hint ? /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { fontSize: 12.5, color: "var(--text-muted)", margin: "2px 0 7px" }, children: spec.hint }) : /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { height: 7 } }),
    picker ? (
      // A project overlay's blank is "inherit", which is exactly what clearing the field does here
      // (applyField deletes the sub-key and prunes the container).
      //
      // `marketplaceDensity` reaches this branch — it became a `choice` when the brand-profile
      // restoration turned it from a free-text box into the two-value pick the engine actually
      // enforces, and it is project-editable. (This comment previously said nothing reached here,
      // which was true only while defaultProduct and the delivery sub-keys were the only choices
      // and both were withheld from the project form.)
      //
      // The inherited value is resolved through choiceLabel rather than printed raw, because a stored
      // value is not a display value: the placeholder must read "Inherited — Standard", never
      // "Inherited — sparse".
      /* @__PURE__ */ jsxRuntimeExports.jsxs("select", { value, onChange: (e) => onChange(e.target.value), style: inputStyle, children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("option", { value: "", children: [
          "Inherited",
          inherited2 ? ` — ${choiceLabel(spec, inherited2) ?? inherited2}` : ""
        ] }),
        (spec.choices ?? []).map((c) => /* @__PURE__ */ jsxRuntimeExports.jsx("option", { value: c.value, children: c.label }, c.value))
      ] })
    ) : multi ? /* @__PURE__ */ jsxRuntimeExports.jsx("textarea", { value, onChange: (e) => onChange(e.target.value), rows: spec.kind === "prose" ? 5 : 3, placeholder: inherited2, style: inputStyle }) : /* @__PURE__ */ jsxRuntimeExports.jsx("input", { value, onChange: (e) => onChange(e.target.value), placeholder: inherited2, style: inputStyle }),
    /* @__PURE__ */ jsxRuntimeExports.jsx(FieldNotices, { notices: fieldNotices(spec, value) }),
    /* @__PURE__ */ jsxRuntimeExports.jsx(FieldPicker, { spec, value, onChange }),
    !set && inherited2 ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { fontSize: 12, color: "var(--text-muted)", marginTop: 4 }, title: inherited2, children: [
      "Inherits:",
      " ",
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { color: "var(--text-strong)" }, "data-anon": "mark", children: summarise(choiceLabel(spec, inherited2) ?? inherited2.split("\n").join(", ")) })
    ] }) : null
  ] });
}
const inputStyle = {
  width: "100%",
  padding: "9px 11px",
  borderRadius: 9,
  border: "1px solid var(--border-hairline)",
  background: "var(--surface-raised)",
  color: "var(--text-strong)",
  fontFamily: "inherit",
  fontSize: 14,
  resize: "vertical"
};
function GlobalConfig({ ctx }) {
  const { result } = useLoad(() => api.adminConfig(), []);
  if (result && result.kind !== "ok") {
    return /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "screen", children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "empty", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx(Icon, { name: "alert", size: 20 }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("p", { children: "This page is not available." })
    ] }) });
  }
  if (!result) return /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "screen" });
  const v = result.value;
  if (!v.available) {
    return /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "screen", children: /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "measure", style: { "--screen-measure": "720px" }, children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "notice", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("b", { children: "Configuration cannot be read from here" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("p", { style: { margin: "6px 0 0", color: "var(--text-muted)", fontSize: 13 }, children: v.note })
    ] }) }) });
  }
  return /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "screen", children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "measure", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx(Group, { title: "Sign-in", children: v.auth ? /* @__PURE__ */ jsxRuntimeExports.jsx(Auth, { auth: v.auth }) : /* @__PURE__ */ jsxRuntimeExports.jsx(NotServed, {}) }),
    /* @__PURE__ */ jsxRuntimeExports.jsx(Group, { title: "Engine", children: v.engine ? /* @__PURE__ */ jsxRuntimeExports.jsx(Engine, { engine: v.engine }) : /* @__PURE__ */ jsxRuntimeExports.jsx(NotRecorded, { what: "which engine is running" }) }),
    /* @__PURE__ */ jsxRuntimeExports.jsx(Group, { title: "Providers", children: v.providers === null ? /* @__PURE__ */ jsxRuntimeExports.jsx(NotRecorded, { what: "which providers are configured" }) : v.providers.length === 0 ? (
      // An empty ARRAY is not reachable from the writer — the inventory is built from the driver's
      // tables, which always hold a register row and at least one research and one search adapter.
      // It is stated anyway, because the alternative is a heading with nothing under it, and a
      // heading with nothing under it reads as "no provider is configured" to the one reader this
      // page exists for. An empty group is a sentence this page has not written.
      /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { fontSize: 13, color: "var(--text-muted)", padding: "10px 13px" }, children: "This snapshot lists no provider at all, which should not be possible. Treat the rest of this page as suspect and check the engine’s last drain." })
    ) : v.providers.map((p) => /* @__PURE__ */ jsxRuntimeExports.jsx(Provider, { p }, `${p.key}:${p.provider ?? "none"}`)) }),
    v.capturedAt || v.stale ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { marginTop: 20, paddingTop: 12, borderTop: "1px solid var(--border-hairline)" }, children: [
      v.capturedAt ? /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { style: { margin: 0, color: "var(--text-muted)", fontSize: 13 }, children: [
        "Updated ",
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "mono", children: v.capturedAt }),
        "."
      ] }) : null,
      v.stale ? /* @__PURE__ */ jsxRuntimeExports.jsx("p", { style: { margin: v.capturedAt ? "6px 0 0" : 0, color: "var(--tone-medium)", fontSize: 13 }, children: "This snapshot is more than a day old. The values on this page are the last known state and may no longer match the engine." }) : null
    ] }) : null
  ] }) });
}
const NotRecorded = ({ what }) => /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { fontSize: 13, color: "var(--text-muted)", padding: "10px 13px" }, children: [
  "This snapshot does not record ",
  what,
  ". It was written by an earlier version of the engine; it will say after the next run on this instance."
] });
const NotServed = () => /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { fontSize: 13, color: "var(--text-muted)", padding: "10px 13px" }, children: "This version of the portal does not report how people sign in. It will say after this service is upgraded — a search engine drain will not add it." });
function Auth({ auth }) {
  const fronted = auth.shape === "fronted";
  const name = fronted ? "A login provider in front" : auth.shape === "local" ? "Local sign-in, one address, loopback only" : "Not a sign-in method this service has";
  const faults = [
    ...auth.missing.length ? [`Set ${auth.missing.join(" and ")}.`] : [],
    // Unreachable from a running portal — portal-service.mjs refuses to start on a mode it does not
    // have — so if a reader ever sees this, the page is being served by something that is not that
    // service, and saying so is more use than a blank row.
    ...auth.shape === "unrecognised" ? ["This service refuses to start in this mode, so this page should not be reachable. Treat it as suspect."] : []
  ];
  return /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx(
      Row$1,
      {
        ok: faults.length === 0,
        name,
        mono: auth.mode,
        state: auth.declared === null ? "Default" : "Configured",
        faults
      }
    ),
    fronted && auth.issuer ? /* @__PURE__ */ jsxRuntimeExports.jsx(Row$1, { ok: true, name: "Issuer", mono: auth.issuer, state: "Configured", faults: [] }) : null
  ] });
}
function Engine({ engine }) {
  const billed = engine.billing.apiBilled ? "API key" : "Subscription";
  const faults = [
    ...engine.known ? [] : [`This build does not ship an engine called ${engine.id}.`],
    ...engine.billing.missing.length ? [`Set to bill an API key, and ${engine.billing.missing.join(" and ")} is not set — a run is refused rather than billed to the subscription.`] : [],
    ...engine.binaryPresent ? [] : ["The engine program cannot be found or run on this machine."]
  ];
  return /* @__PURE__ */ jsxRuntimeExports.jsx(
    Row$1,
    {
      ok: faults.length === 0,
      name: engine.vendor ?? engine.id,
      mono: engine.id,
      state: billed,
      faults
    }
  );
}
function Provider({ p }) {
  const faults = p.remedy ? [p.remedy] : p.configured ? [] : p.provider === null ? [`No register is selected. Set ${p.missing.join(" and ")}.`] : !p.known ? [`This build does not ship a provider called ${p.provider}.`] : [`Set ${p.missing.join(" and ")}.`];
  return /* @__PURE__ */ jsxRuntimeExports.jsx(
    Row$1,
    {
      ok: p.configured,
      name: p.label,
      mono: p.providerLabel ?? p.provider ?? null,
      state: p.configured ? "Configured" : !p.known ? "Not in this build" : p.missing.length ? "Missing" : "Not set up",
      faults
    }
  );
}
function Row$1({
  ok,
  name,
  mono,
  state,
  faults
}) {
  return /* @__PURE__ */ jsxRuntimeExports.jsxs(
    "div",
    {
      style: {
        padding: "10px 13px",
        borderRadius: 9,
        border: "1px solid var(--border-hairline)",
        background: "var(--surface-raised)"
      },
      children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { display: "flex", alignItems: "center", gap: 12 }, children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(Dot, { ok }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { flex: 1, color: "var(--text-strong)", fontSize: 13 }, children: name }),
          mono ? /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { fontSize: 12.5, color: "var(--text-muted)" }, children: mono }) : null,
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { fontSize: 12.5, color: ok ? "var(--text-muted)" : "var(--tone-high)", minWidth: 86, textAlign: "right" }, children: state })
        ] }),
        faults.map((f) => /* @__PURE__ */ jsxRuntimeExports.jsx("p", { style: { margin: "6px 0 0 21px", fontSize: 12.5, color: "var(--tone-high)" }, children: f }, f))
      ]
    }
  );
}
function Group({ title, children }) {
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { marginTop: 22 }, children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { fontWeight: 700, color: "var(--text-strong)", fontSize: 15, marginBottom: 8 }, children: title }),
    /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { display: "grid", gap: 6 }, children })
  ] });
}
const Dot = ({ ok }) => /* @__PURE__ */ jsxRuntimeExports.jsx(
  "span",
  {
    className: "dot",
    style: { background: ok ? "var(--tone-minimal)" : "var(--tone-high)", width: 9, height: 9, flex: "none" }
  }
);
function PeopleAccess({ ctx }) {
  const { result } = useLoad(() => api.adminAccess(), []);
  const { result: observed } = useLoad(() => api.adminObserved(), []);
  if (result && result.kind !== "ok") {
    return /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "screen", children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "empty", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx(Icon, { name: "alert", size: 20 }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("p", { children: "This page is not available." })
    ] }) });
  }
  if (!result) return /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "screen" });
  const v = result.value;
  const broken = v.people.filter((p) => p.dangling.length > 0);
  return /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "screen", children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "measure", style: { "--screen-measure": "780px" }, children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "notice quiet", style: { marginBottom: 18 }, children: /* @__PURE__ */ jsxRuntimeExports.jsx("p", { style: { margin: 0, color: "var(--text-muted)", fontSize: 13 }, children: v.note }) }),
    broken.length ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "notice", style: { borderColor: "var(--tone-high)", marginBottom: 18 }, children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("b", { children: broken.length === 1 ? "One grant names an account that does not exist" : `${broken.length} grants name accounts that do not exist` }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("p", { style: { margin: "6px 0 8px", color: "var(--text-muted)", fontSize: 13 }, children: "Usually a spelling mistake. It fails silently: the person signs in and simply cannot see that brand owner, with nothing to explain why." }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("ul", { style: { margin: 0, paddingLeft: 18, color: "var(--text-muted)", fontSize: 13 }, children: broken.map((p) => /* @__PURE__ */ jsxRuntimeExports.jsxs("li", { style: { marginBottom: 3 }, children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { "data-anon": "mark", children: p.email }),
        " → ",
        /* @__PURE__ */ jsxRuntimeExports.jsx("b", { children: p.dangling.join(", ") })
      ] }, p.email)) })
    ] }) : null,
    v.unknownAccounts.length ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "notice", style: { borderColor: "var(--tone-medium)", marginBottom: 18 }, children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("b", { children: "Accounts with no brand owner configured" }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { style: { margin: "6px 0 0", color: "var(--text-muted)", fontSize: 13 }, children: [
        "Named in the access list but with no profile: ",
        /* @__PURE__ */ jsxRuntimeExports.jsx("b", { children: v.unknownAccounts.join(", ") }),
        ". Anyone granted one of these will sign in and find nothing there."
      ] })
    ] }) : null,
    /* @__PURE__ */ jsxRuntimeExports.jsx(Roles, { brand: ctx.me.brand }),
    /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { fontWeight: 700, color: "var(--text-strong)", fontSize: 15, marginBottom: 8 }, children: "Who can sign in" }),
    v.staffDomains.length ? /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { fontWeight: 600, color: "var(--text-muted)", fontSize: 12.5, margin: "10px 0 6px" }, children: [
        "Staff ",
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { color: "var(--text-faint)" }, children: "— a config rule, not a person" })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { display: "grid", gap: 6 }, children: /* @__PURE__ */ jsxRuntimeExports.jsx(StaffRuleRow, { domains: v.staffDomains }) })
    ] }) : null,
    /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { fontWeight: 600, color: "var(--text-muted)", fontSize: 12.5, margin: "14px 0 6px" }, children: "Clients" }),
    v.people.length === 0 ? /* @__PURE__ */ jsxRuntimeExports.jsx("p", { style: { color: "var(--text-muted)", fontSize: 13, margin: 0 }, children: "No client is enrolled on this instance yet." }) : /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { display: "grid", gap: 6 }, children: v.people.map((p) => /* @__PURE__ */ jsxRuntimeExports.jsx(Row, { person: p }, p.email)) }),
    v.grantsFile ? /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { style: { color: "var(--text-muted)", fontSize: 12.5, marginTop: 14 }, children: [
      "Access is not currently configurable via the UI. Use the provided CLI —",
      " ",
      /* @__PURE__ */ jsxRuntimeExports.jsx("b", { className: "mono", children: "clearotron grant" }),
      " — which is a back end change. Last changed",
      " ",
      new Date(v.grantsFile.modifiedAt).toLocaleDateString(void 0, { day: "numeric", month: "long", year: "numeric" }),
      "."
    ] }) : null,
    /* @__PURE__ */ jsxRuntimeExports.jsx(Observed, { result: observed })
  ] }) });
}
function Roles({ brand }) {
  const Role = ({ name, children }) => /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { marginTop: 8 }, children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { fontWeight: 700, color: "var(--text-strong)", fontSize: 13.5 }, children: name }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { style: { color: "var(--text-muted)", fontSize: 13 }, children: [
      " — ",
      children
    ] })
  ] });
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "notice quiet", style: { marginBottom: 18 }, children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "eyebrow", children: "Two roles currently exist" }),
    /* @__PURE__ */ jsxRuntimeExports.jsx(Role, { name: staffLabel(brand), children: "capable to see every brand owner." }),
    /* @__PURE__ */ jsxRuntimeExports.jsx(Role, { name: "Clients", children: "reaches only the brand owners named in their grants, and those brand owners’ projects, and nothing else. A brand owner they are not granted is not visible." })
  ] });
}
function StaffRuleRow({ domains }) {
  return /* @__PURE__ */ jsxRuntimeExports.jsx(
    "div",
    {
      style: {
        padding: "10px 13px",
        borderRadius: 9,
        border: "1px solid var(--border-hairline)",
        background: "var(--surface-raised)"
      },
      children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }, children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { style: { fontWeight: 600, color: "var(--text-strong)", fontSize: 13.5 }, children: [
          "Anyone at ",
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { "data-anon": "mark", children: domains.join(", ") })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "pill", style: { fontSize: 10.5, padding: "1px 7px" }, children: "a rule, not a person" })
      ] })
    }
  );
}
function Observed({ result }) {
  if (!result) return null;
  if (result.kind !== "ok") return null;
  const v = result.value;
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { marginTop: 26 }, children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { fontWeight: 700, color: "var(--text-strong)", fontSize: 15, marginBottom: 4 }, children: "Seen recently" }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { style: { margin: "0 0 10px", color: "var(--text-muted)", fontSize: 12.5 }, children: [
      "Identities that have planned, started or saved something here, most recent first.",
      v.truncated ? " Only the most recent activity is read." : "",
      " ",
      "Somebody absent from this list still has access — they have simply not done anything in the window shown."
    ] }),
    !v.available ? /* @__PURE__ */ jsxRuntimeExports.jsx("p", { style: { color: "var(--text-muted)", fontSize: 12.5 }, children: v.note }) : v.people.length === 0 ? /* @__PURE__ */ jsxRuntimeExports.jsx("p", { style: { color: "var(--text-muted)", fontSize: 12.5 }, children: "Nothing recorded yet." }) : /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { display: "grid", gap: 6 }, children: v.people.map((p) => /* @__PURE__ */ jsxRuntimeExports.jsxs(
      "div",
      {
        style: {
          padding: "9px 13px",
          borderRadius: 9,
          border: "1px solid var(--border-hairline)",
          background: "var(--surface-raised)"
        },
        children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }, children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { fontWeight: 600, color: "var(--text-strong)", fontSize: 13.5 }, "data-anon": "mark", children: p.email }),
            p.accounts.map((a) => /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "pill", style: { fontSize: 10.5, padding: "1px 7px" }, "data-anon": "mark", children: a }, a))
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { fontSize: 12.5, color: "var(--text-muted)", marginTop: 4 }, children: [
            Object.entries(p.events).map(([e, n]) => `${e} ×${n}`).join(" · "),
            p.lastSeen ? ` — last ${new Date(p.lastSeen).toLocaleDateString(void 0, { day: "numeric", month: "short" })}` : ""
          ] })
        ]
      },
      p.email
    )) })
  ] });
}
function Row({ person }) {
  const bad = person.dangling.length > 0;
  return /* @__PURE__ */ jsxRuntimeExports.jsxs(
    "div",
    {
      style: {
        padding: "10px 13px",
        borderRadius: 9,
        border: `1px solid ${bad ? "var(--tone-high)" : "var(--border-hairline)"}`,
        background: "var(--surface-raised)"
      },
      children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }, children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { fontWeight: 600, color: "var(--text-strong)", fontSize: 13.5 }, "data-anon": "mark", children: person.email }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "pill", style: { fontSize: 10.5, padding: "1px 7px" }, "data-anon": "mark", children: person.tenant }),
          person.wildcard ? (
            // Worth surfacing: this grant follows the tenant. Adding a brand owner to that tenant silently
            // widens what this person can see, which is right but should not be a surprise.
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "pill", style: { fontSize: 10.5, padding: "1px 7px" }, children: "all of this tenant" })
          ) : null
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { fontSize: 12.5, color: "var(--text-muted)", marginTop: 4 }, children: person.accounts.length ? /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
          "Reaches: ",
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { color: "var(--text-strong)" }, "data-anon": "mark", children: person.accounts.join(", ") })
        ] }) : "Reaches nothing — signed in, but granted no brand owner." })
      ]
    }
  );
}
const LICENCE_URL = "https://www.gnu.org/licenses/agpl-3.0.html";
function About() {
  const [info, setInfo] = reactExports.useState(null);
  const [failed, setFailed] = reactExports.useState(false);
  reactExports.useEffect(() => {
    let live = true;
    void api.about().then((r) => {
      if (!live) return;
      if (isOk(r)) setInfo(r.value);
      else setFailed(true);
    });
    return () => {
      live = false;
    };
  }, []);
  if (failed) {
    return /* @__PURE__ */ jsxRuntimeExports.jsxs("section", { className: "screen", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("h1", { children: "About" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("p", { children: "This deployment could not report which build it is running. That is a fault, not a configuration choice — the source offer below is incomplete without it." }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { children: [
        "Source: ",
        /* @__PURE__ */ jsxRuntimeExports.jsx("a", { href: "https://github.com/CordilleraSarl/Clearotron", children: "github.com/CordilleraSarl/Clearotron" })
      ] })
    ] });
  }
  if (!info) return /* @__PURE__ */ jsxRuntimeExports.jsxs("section", { className: "screen", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx("h1", { children: "About" }),
    /* @__PURE__ */ jsxRuntimeExports.jsx("p", { children: "Loading…" })
  ] });
  const shortSha = info.commit ? info.commit.slice(0, 12) : null;
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("section", { className: "screen", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs("h1", { children: [
      "About ",
      info.name
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("dl", { children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("dt", { children: "Product" }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("dd", { children: [
        info.name,
        info.version ? ` ${info.version}` : ""
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("dt", { children: "Build" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("dd", { children: shortSha ? /* @__PURE__ */ jsxRuntimeExports.jsx("code", { title: info.commit ?? void 0, children: shortSha }) : /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "not reported by this deployment" }) }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("dt", { children: "Source" }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("dd", { children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("a", { href: info.sourceUrl, rel: "noreferrer", children: info.sourceUrl }),
        !info.commit && /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
          " ",
          /* @__PURE__ */ jsxRuntimeExports.jsx("strong", { children: "This links to the repository, not to the exact build you are using — this deployment could not report its commit." })
        ] })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("dt", { children: "Licence" }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("dd", { children: [
        info.license ?? "not reported",
        " — ",
        /* @__PURE__ */ jsxRuntimeExports.jsx("a", { href: LICENCE_URL, rel: "noreferrer", children: "full text" })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("dt", { children: "Copyright" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("dd", { children: info.copyright })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("a", { href: `${info.sourceRepo}/blob/main/LICENSE`, rel: "noreferrer", children: "Licence" }),
      " · ",
      /* @__PURE__ */ jsxRuntimeExports.jsx("a", { href: `${info.sourceRepo}/blob/main/NOTICES.md`, rel: "noreferrer", children: "Notices" }),
      " · ",
      /* @__PURE__ */ jsxRuntimeExports.jsx("a", { href: `${info.sourceRepo}/blob/main/TRADEMARKS.md`, rel: "noreferrer", children: "Trademarks policy" }),
      " · ",
      /* @__PURE__ */ jsxRuntimeExports.jsx("a", { href: `${info.sourceRepo}/blob/main/CONTRIBUTING.md`, rel: "noreferrer", children: "Contributing" }),
      " · ",
      /* @__PURE__ */ jsxRuntimeExports.jsx("a", { href: `${info.sourceRepo}/blob/main/SECURITY.md`, rel: "noreferrer", children: "Security" }),
      " · ",
      /* @__PURE__ */ jsxRuntimeExports.jsx("a", { href: `${info.sourceRepo}/blob/main/CODE_OF_CONDUCT.md`, rel: "noreferrer", children: "Code of conduct" }),
      " · ",
      /* @__PURE__ */ jsxRuntimeExports.jsx("a", { href: info.sourceRepo, rel: "noreferrer", children: "View on GitHub" }),
      " · ",
      /* @__PURE__ */ jsxRuntimeExports.jsx("a", { href: "https://clearotron.ai", rel: "noreferrer", children: "clearotron.ai" })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("strong", { children: info.name }),
      " and the mountain mark are trade marks of Cordillera Sàrl. The licence above covers the software; it does not grant any right in the name or the mark. See",
      " ",
      /* @__PURE__ */ jsxRuntimeExports.jsx("a", { href: `${info.sourceRepo}/blob/main/TRADEMARKS.md`, rel: "noreferrer", children: "TRADEMARKS.md" }),
      "."
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsx("p", { children: "This runs on your own model access — a subscription or your own API key — and the paid registers on your own agreements with those providers. The reasoning stages are a proprietary third-party CLI that you install and license under that vendor’s own terms; this licence grants nothing over any of them." })
  ] });
}
function NotYet({ title, phase, what }) {
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "screen", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "eyebrow", children: title }),
    /* @__PURE__ */ jsxRuntimeExports.jsx("h1", { style: { fontSize: 25, margin: "4px 0 10px", color: "var(--text-strong)" }, children: title }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "notice quiet", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("p", { style: { margin: 0, color: "var(--text-muted)" }, children: what }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { style: { margin: "8px 0 0", fontSize: 13, color: "var(--text-faint)" }, children: [
        "Being built — ",
        phase,
        "."
      ] })
    ] })
  ] });
}
const ownerKey = (ctx) => `${ctx.owner ?? "*"}#${ctx.visit}`;
function screen(id, ctx) {
  switch (id) {
    case "home":
      return /* @__PURE__ */ jsxRuntimeExports.jsx(Home, { ctx }, ownerKey(ctx));
    case "clearances":
      return /* @__PURE__ */ jsxRuntimeExports.jsx(Clearances, { ctx }, ownerKey(ctx));
    case "new":
      return /* @__PURE__ */ jsxRuntimeExports.jsx(
        NewClearance,
        {
          ctx
        },
        `${ownerKey(ctx)}::${new URLSearchParams(window.location.search).get("search") ?? ""}`
      );
    case "ai":
      return /* @__PURE__ */ jsxRuntimeExports.jsx(UseYourAI, { ctx });
    case "result": {
      const { runId, markSlug } = resultRoute(window.location.pathname);
      if (!runId) {
        ctx.go("/portal/clearances", { replace: true });
        return /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "screen" });
      }
      return /* @__PURE__ */ jsxRuntimeExports.jsx(Result, { ctx, runId, markSlug }, `${runId}/${markSlug ?? ""}#${ctx.visit}`);
    }
    case "brand.profile":
      return /* @__PURE__ */ jsxRuntimeExports.jsx(Profile, { ctx }, ownerKey(ctx));
    case "brand.projects":
      return /* @__PURE__ */ jsxRuntimeExports.jsx(Projects, { ctx }, ownerKey(ctx));
    case "brand.searches":
      return /* @__PURE__ */ jsxRuntimeExports.jsx(SavedSearches, { ctx }, ownerKey(ctx));
    case "preferences":
      return /* @__PURE__ */ jsxRuntimeExports.jsx(Preferences, { ctx });
    // No ctx: the source offer is the same for every reader and depends on no account, no owner and
    // no role. Passing one would imply a scope it does not have.
    case "about":
      return /* @__PURE__ */ jsxRuntimeExports.jsx(About, {});
    // Admin settings has no screen of its own; landing on the parent shows its first child, the way
    // /portal/settings used to fall through to Profile.
    case "admin":
    case "admin.access":
      return /* @__PURE__ */ jsxRuntimeExports.jsx(PeopleAccess, { ctx });
    case "admin.config":
      return /* @__PURE__ */ jsxRuntimeExports.jsx(GlobalConfig, { ctx });
    default: {
      return /* @__PURE__ */ jsxRuntimeExports.jsx(NotYet, { title: "Not built", phase: "a later phase", what: "This screen has not been built yet." });
    }
  }
}
const root = document.getElementById("root");
if (!root) throw new Error("#root is missing from index.html");
clientExports.createRoot(root).render(
  /* @__PURE__ */ jsxRuntimeExports.jsx(reactExports.StrictMode, { children: /* @__PURE__ */ jsxRuntimeExports.jsx(AppShell, { render: screen }) })
);
