/**
 * @license Copyright 2013 Andy Earnshaw, MIT License
 *
 * Implements the ECMAScript Internationalization API in ES5-compatible environments,
 * following the ECMA-402 specification as closely as possible
 *
 * ECMA-402: http://ecma-international.org/ecma-402/1.0/
 *
 * CLDR format locale data should be provided using IntlPolyfill.__addLocaleData().
 */
/*jshint proto:true, eqnull:true, boss:true, laxbreak:true, newcap:false, shadow:true, funcscope:true */
/*globals global, define, exports, module, window*/

(function (global, factory) {
    var IntlPolyfill = factory();

    // register in -all- the module systems (at once)
    if (typeof define === 'function' && define.amd)
        define(IntlPolyfill);

    if (typeof exports === 'object')
        module.exports = IntlPolyfill;

    if (!global.Intl) {
        global.Intl = IntlPolyfill;
        IntlPolyfill.__applyLocaleSensitivePrototypes();
    }

    global.IntlPolyfill = IntlPolyfill;

})(typeof global !== 'undefined' ? global : this, function() {
"use strict";
var
    Intl = {},

    realDefineProp = (function () {
        try { return !!Object.defineProperty({}, 'a', {}); }
        catch (e) { return false; }
    })(),

    // Need a workaround for getters in ES3
    es3  = !realDefineProp && !Object.prototype.__defineGetter__,

    // We use this a lot (and need it for proto-less objects)
    hop = Object.prototype.hasOwnProperty,

    // Naive defineProperty for compatibility
    defineProperty = realDefineProp ? Object.defineProperty : function (obj, name, desc) {
        if ('get' in desc && obj.__defineGetter__)
            obj.__defineGetter__(name, desc.get);

        else if (!hop.call(obj, name) || 'value' in desc)
            obj[name] = desc.value;
    },

    // Array.prototype.indexOf, as good as we need it to be
    arrIndexOf = Array.prototype.indexOf || function (search) {
        /*jshint validthis:true */
        var t = this;
        if (!t.length)
            return -1;

        for (var i = arguments[1] || 0, max = t.length; i < max; i++) {
            if (t[i] === search)
                return i;
        }

        return -1;
    },

    // Create an object with the specified prototype (2nd arg required for Record)
    objCreate = Object.create || function (proto, props) {
        var obj;

        function F() {}
        F.prototype = proto;
        obj = new F();

        for (var k in props) {
            if (hop.call(props, k))
                defineProperty(obj, k, props[k]);
        }

        return obj;
    },

    // Snapshot some (hopefully still) native built-ins
    arrSlice  = Array.prototype.slice,
    arrConcat = Array.prototype.concat,
    arrPush   = Array.prototype.push,
    arrJoin   = Array.prototype.join,
    arrShift  = Array.prototype.shift,
    arrUnshift= Array.prototype.unshift,

    // Naive Function.prototype.bind for compatibility
    fnBind = Function.prototype.bind || function (thisObj) {
        var fn = this,
            args = arrSlice.call(arguments, 1);

        // All our (presently) bound functions have either 1 or 0 arguments. By returning
        // different function signatures, we can pass some tests in ES3 environments
        if (fn.length === 1) {
            return function (a) {
                return fn.apply(thisObj, arrConcat.call(args, arrSlice.call(arguments)));
            };
        }
        else {
            return function () {
                return fn.apply(thisObj, arrConcat.call(args, arrSlice.call(arguments)));
            };
        }
    },

    // Default locale is the first-added locale data for us
    defaultLocale,

    // Object housing internal properties for constructors
    internals = objCreate(null),

    // Keep internal properties internal
    secret = Math.random(),

    // An object map of date component keys, saves using a regex later
    dateWidths = objCreate(null, { narrow:{}, short:{}, long:{} }),

    // Each constructor prototype should be an instance of the constructor itself, but we
    // can't initialise them as such until some locale data has been added, so this is how
    // we keep track
    numberFormatProtoInitialised = false,
    dateTimeFormatProtoInitialised = false,

    // Some regular expressions we're using
    expCurrencyCode = /^[A-Z]{3}$/,
    expUnicodeExSeq = /-u(?:-[0-9a-z]{2,8})+/gi, // See `extension` below

    expBCP47Syntax,
    expExtSequences,
    expVariantDupes,
    expSingletonDupes,

    // IANA Subtag Registry redundant tag and subtag maps
    redundantTags = {
        tags: {
            "art-lojban":   "jbo",       "i-ami":        "ami",       "i-bnn":       "bnn",  "i-hak":      "hak",
            "i-klingon":    "tlh",       "i-lux":        "lb",        "i-navajo":    "nv",   "i-pwn":      "pwn",
            "i-tao":        "tao",       "i-tay":        "tay",       "i-tsu":       "tsu",  "no-bok":     "nb",
            "no-nyn":       "nn",        "sgn-BE-FR":    "sfb",       "sgn-BE-NL":   "vgt",  "sgn-CH-DE":  "sgg",
            "zh-guoyu":     "cmn",       "zh-hakka":     "hak",       "zh-min-nan":  "nan",  "zh-xiang":   "hsn",
            "sgn-BR":       "bzs",       "sgn-CO":       "csn",       "sgn-DE":      "gsg",  "sgn-DK":     "dsl",
            "sgn-ES":       "ssp",       "sgn-FR":       "fsl",       "sgn-GB":      "bfi",  "sgn-GR":     "gss",
            "sgn-IE":       "isg",       "sgn-IT":       "ise",       "sgn-JP":      "jsl",  "sgn-MX":     "mfs",
            "sgn-NI":       "ncs",       "sgn-NL":       "dse",       "sgn-NO":      "nsl",  "sgn-PT":     "psr",
            "sgn-SE":       "swl",       "sgn-US":       "ase",       "sgn-ZA":      "sfs",  "zh-cmn":     "cmn",
            "zh-cmn-Hans":  "cmn-Hans",  "zh-cmn-Hant":  "cmn-Hant",  "zh-gan":      "gan",  "zh-wuu":     "wuu",
            "zh-yue":       "yue"
        },
        subtags: {
              BU: "MM",   DD: "DE",   FX: "FR",   TP: "TL",   YD: "YE",   ZR: "CD",  heploc: "alalc97",
            'in': "id",   iw: "he",   ji:  "yi",  jw: "jv",   mo: "ro",  ayx: "nun", bjd: "drl",
             ccq: "rki", cjr: "mom", cka: "cmr", cmk: "xch", drh: "khk", drw: "prs", gav: "dev",
             hrr: "jal", ibi: "opa", kgh: "kml", lcq: "ppr", mst: "mry", myt: "mry", sca: "hle",
             tie: "ras", tkk: "twm", tlw: "weo", tnf: "prs", ybd: "rki", yma: "lrr"
        },
        extLang: {
            aao: [ "aao", "ar"  ], abh: [ "abh", "ar"  ], abv: [ "abv", "ar"  ], acm: [ "acm", "ar"  ],
            acq: [ "acq", "ar"  ], acw: [ "acw", "ar"  ], acx: [ "acx", "ar"  ], acy: [ "acy", "ar"  ],
            adf: [ "adf", "ar"  ], ads: [ "ads", "sgn" ], aeb: [ "aeb", "ar"  ], aec: [ "aec", "ar"  ],
            aed: [ "aed", "sgn" ], aen: [ "aen", "sgn" ], afb: [ "afb", "ar"  ], afg: [ "afg", "sgn" ],
            ajp: [ "ajp", "ar"  ], apc: [ "apc", "ar"  ], apd: [ "apd", "ar"  ], arb: [ "arb", "ar"  ],
            arq: [ "arq", "ar"  ], ars: [ "ars", "ar"  ], ary: [ "ary", "ar"  ], arz: [ "arz", "ar"  ],
            ase: [ "ase", "sgn" ], asf: [ "asf", "sgn" ], asp: [ "asp", "sgn" ], asq: [ "asq", "sgn" ],
            asw: [ "asw", "sgn" ], auz: [ "auz", "ar"  ], avl: [ "avl", "ar"  ], ayh: [ "ayh", "ar"  ],
            ayl: [ "ayl", "ar"  ], ayn: [ "ayn", "ar"  ], ayp: [ "ayp", "ar"  ], bbz: [ "bbz", "ar"  ],
            bfi: [ "bfi", "sgn" ], bfk: [ "bfk", "sgn" ], bjn: [ "bjn", "ms"  ], bog: [ "bog", "sgn" ],
            bqn: [ "bqn", "sgn" ], bqy: [ "bqy", "sgn" ], btj: [ "btj", "ms"  ], bve: [ "bve", "ms"  ],
            bvl: [ "bvl", "sgn" ], bvu: [ "bvu", "ms"  ], bzs: [ "bzs", "sgn" ], cdo: [ "cdo", "zh"  ],
            cds: [ "cds", "sgn" ], cjy: [ "cjy", "zh"  ], cmn: [ "cmn", "zh"  ], coa: [ "coa", "ms"  ],
            cpx: [ "cpx", "zh"  ], csc: [ "csc", "sgn" ], csd: [ "csd", "sgn" ], cse: [ "cse", "sgn" ],
            csf: [ "csf", "sgn" ], csg: [ "csg", "sgn" ], csl: [ "csl", "sgn" ], csn: [ "csn", "sgn" ],
            csq: [ "csq", "sgn" ], csr: [ "csr", "sgn" ], czh: [ "czh", "zh"  ], czo: [ "czo", "zh"  ],
            doq: [ "doq", "sgn" ], dse: [ "dse", "sgn" ], dsl: [ "dsl", "sgn" ], dup: [ "dup", "ms"  ],
            ecs: [ "ecs", "sgn" ], esl: [ "esl", "sgn" ], esn: [ "esn", "sgn" ], eso: [ "eso", "sgn" ],
            eth: [ "eth", "sgn" ], fcs: [ "fcs", "sgn" ], fse: [ "fse", "sgn" ], fsl: [ "fsl", "sgn" ],
            fss: [ "fss", "sgn" ], gan: [ "gan", "zh"  ], gds: [ "gds", "sgn" ], gom: [ "gom", "kok" ],
            gse: [ "gse", "sgn" ], gsg: [ "gsg", "sgn" ], gsm: [ "gsm", "sgn" ], gss: [ "gss", "sgn" ],
            gus: [ "gus", "sgn" ], hab: [ "hab", "sgn" ], haf: [ "haf", "sgn" ], hak: [ "hak", "zh"  ],
            hds: [ "hds", "sgn" ], hji: [ "hji", "ms"  ], hks: [ "hks", "sgn" ], hos: [ "hos", "sgn" ],
            hps: [ "hps", "sgn" ], hsh: [ "hsh", "sgn" ], hsl: [ "hsl", "sgn" ], hsn: [ "hsn", "zh"  ],
            icl: [ "icl", "sgn" ], ils: [ "ils", "sgn" ], inl: [ "inl", "sgn" ], ins: [ "ins", "sgn" ],
            ise: [ "ise", "sgn" ], isg: [ "isg", "sgn" ], isr: [ "isr", "sgn" ], jak: [ "jak", "ms"  ],
            jax: [ "jax", "ms"  ], jcs: [ "jcs", "sgn" ], jhs: [ "jhs", "sgn" ], jls: [ "jls", "sgn" ],
            jos: [ "jos", "sgn" ], jsl: [ "jsl", "sgn" ], jus: [ "jus", "sgn" ], kgi: [ "kgi", "sgn" ],
            knn: [ "knn", "kok" ], kvb: [ "kvb", "ms"  ], kvk: [ "kvk", "sgn" ], kvr: [ "kvr", "ms"  ],
            kxd: [ "kxd", "ms"  ], lbs: [ "lbs", "sgn" ], lce: [ "lce", "ms"  ], lcf: [ "lcf", "ms"  ],
            liw: [ "liw", "ms"  ], lls: [ "lls", "sgn" ], lsg: [ "lsg", "sgn" ], lsl: [ "lsl", "sgn" ],
            lso: [ "lso", "sgn" ], lsp: [ "lsp", "sgn" ], lst: [ "lst", "sgn" ], lsy: [ "lsy", "sgn" ],
            ltg: [ "ltg", "lv"  ], lvs: [ "lvs", "lv"  ], lzh: [ "lzh", "zh"  ], max: [ "max", "ms"  ],
            mdl: [ "mdl", "sgn" ], meo: [ "meo", "ms"  ], mfa: [ "mfa", "ms"  ], mfb: [ "mfb", "ms"  ],
            mfs: [ "mfs", "sgn" ], min: [ "min", "ms"  ], mnp: [ "mnp", "zh"  ], mqg: [ "mqg", "ms"  ],
            mre: [ "mre", "sgn" ], msd: [ "msd", "sgn" ], msi: [ "msi", "ms"  ], msr: [ "msr", "sgn" ],
            mui: [ "mui", "ms"  ], mzc: [ "mzc", "sgn" ], mzg: [ "mzg", "sgn" ], mzy: [ "mzy", "sgn" ],
            nan: [ "nan", "zh"  ], nbs: [ "nbs", "sgn" ], ncs: [ "ncs", "sgn" ], nsi: [ "nsi", "sgn" ],
            nsl: [ "nsl", "sgn" ], nsp: [ "nsp", "sgn" ], nsr: [ "nsr", "sgn" ], nzs: [ "nzs", "sgn" ],
            okl: [ "okl", "sgn" ], orn: [ "orn", "ms"  ], ors: [ "ors", "ms"  ], pel: [ "pel", "ms"  ],
            pga: [ "pga", "ar"  ], pks: [ "pks", "sgn" ], prl: [ "prl", "sgn" ], prz: [ "prz", "sgn" ],
            psc: [ "psc", "sgn" ], psd: [ "psd", "sgn" ], pse: [ "pse", "ms"  ], psg: [ "psg", "sgn" ],
            psl: [ "psl", "sgn" ], pso: [ "pso", "sgn" ], psp: [ "psp", "sgn" ], psr: [ "psr", "sgn" ],
            pys: [ "pys", "sgn" ], rms: [ "rms", "sgn" ], rsi: [ "rsi", "sgn" ], rsl: [ "rsl", "sgn" ],
            sdl: [ "sdl", "sgn" ], sfb: [ "sfb", "sgn" ], sfs: [ "sfs", "sgn" ], sgg: [ "sgg", "sgn" ],
            sgx: [ "sgx", "sgn" ], shu: [ "shu", "ar"  ], slf: [ "slf", "sgn" ], sls: [ "sls", "sgn" ],
            sqk: [ "sqk", "sgn" ], sqs: [ "sqs", "sgn" ], ssh: [ "ssh", "ar"  ], ssp: [ "ssp", "sgn" ],
            ssr: [ "ssr", "sgn" ], svk: [ "svk", "sgn" ], swc: [ "swc", "sw"  ], swh: [ "swh", "sw"  ],
            swl: [ "swl", "sgn" ], syy: [ "syy", "sgn" ], tmw: [ "tmw", "ms"  ], tse: [ "tse", "sgn" ],
            tsm: [ "tsm", "sgn" ], tsq: [ "tsq", "sgn" ], tss: [ "tss", "sgn" ], tsy: [ "tsy", "sgn" ],
            tza: [ "tza", "sgn" ], ugn: [ "ugn", "sgn" ], ugy: [ "ugy", "sgn" ], ukl: [ "ukl", "sgn" ],
            uks: [ "uks", "sgn" ], urk: [ "urk", "ms"  ], uzn: [ "uzn", "uz"  ], uzs: [ "uzs", "uz"  ],
            vgt: [ "vgt", "sgn" ], vkk: [ "vkk", "ms"  ], vkt: [ "vkt", "ms"  ], vsi: [ "vsi", "sgn" ],
            vsl: [ "vsl", "sgn" ], vsv: [ "vsv", "sgn" ], wuu: [ "wuu", "zh"  ], xki: [ "xki", "sgn" ],
            xml: [ "xml", "sgn" ], xmm: [ "xmm", "ms"  ], xms: [ "xms", "sgn" ], yds: [ "yds", "sgn" ],
            ysl: [ "ysl", "sgn" ], yue: [ "yue", "zh"  ], zib: [ "zib", "sgn" ], zlm: [ "zlm", "ms"  ],
            zmi: [ "zmi", "ms"  ], zsl: [ "zsl", "sgn" ], zsm: [ "zsm", "ms"  ]
        }
    },

    // Currency minor units output from tools/getISO4217data.js, formatted
    currencyMinorUnits = {
        BHD: 3, BYR: 0, XOF: 0, BIF: 0, XAF: 0, CLF: 0, CLP: 0, KMF: 0, DJF: 0,
        XPF: 0, GNF: 0, ISK: 0, IQD: 3, JPY: 0, JOD: 3, KRW: 0, KWD: 3, LYD: 3,
        OMR: 3, PYG: 0, RWF: 0, TND: 3, UGX: 0, UYI: 0, VUV: 0, VND: 0
    };

/**
 * Defines regular expressions for various operations related to the BCP 47 syntax,
 * as defined at http://tools.ietf.org/html/bcp47#section-2.1
 */
(function () {
    var
        // extlang       = 3ALPHA              ; selected ISO 639 codes
        //                 *2("-" 3ALPHA)      ; permanently reserved
        extlang = '[a-z]{3}(?:-[a-z]{3}){0,2}',

        // language      = 2*3ALPHA            ; shortest ISO 639 code
        //                 ["-" extlang]       ; sometimes followed by
        //                                     ; extended language subtags
        //               / 4ALPHA              ; or reserved for future use
        //               / 5*8ALPHA            ; or registered language subtag
        language = '(?:[a-z]{2,3}(?:-' + extlang + ')?|[a-z]{4}|[a-z]{5,8})',

        // script        = 4ALPHA              ; ISO 15924 code
        script = '[a-z]{4}',

        // region        = 2ALPHA              ; ISO 3166-1 code
        //               / 3DIGIT              ; UN M.49 code
        region = '(?:[a-z]{2}|\\d{3})',

        // variant       = 5*8alphanum         ; registered variants
        //               / (DIGIT 3alphanum)
        variant = '(?:[a-z0-9]{5,8}|\\d[a-z0-9]{3})',

        //                                     ; Single alphanumerics
        //                                     ; "x" reserved for private use
        // singleton     = DIGIT               ; 0 - 9
        //               / %x41-57             ; A - W
        //               / %x59-5A             ; Y - Z
        //               / %x61-77             ; a - w
        //               / %x79-7A             ; y - z
        singleton = '[0-9a-wy-z]',

        // extension     = singleton 1*("-" (2*8alphanum))
        extension = singleton + '(?:-[a-z0-9]{2,8})+',

        // privateuse    = "x" 1*("-" (1*8alphanum))
        privateuse = 'x(?:-[a-z0-9]{1,8})+',

        // irregular     = "en-GB-oed"         ; irregular tags do not match
        //               / "i-ami"             ; the 'langtag' production and
        //               / "i-bnn"             ; would not otherwise be
        //               / "i-default"         ; considered 'well-formed'
        //               / "i-enochian"        ; These tags are all valid,
        //               / "i-hak"             ; but most are deprecated
        //               / "i-klingon"         ; in favor of more modern
        //               / "i-lux"             ; subtags or subtag
        //               / "i-mingo"           ; combination
        //               / "i-navajo"
        //               / "i-pwn"
        //               / "i-tao"
        //               / "i-tay"
        //               / "i-tsu"
        //               / "sgn-BE-FR"
        //               / "sgn-BE-NL"
        //               / "sgn-CH-DE"
        irregular = '(?:en-GB-oed'
                  + '|i-(?:ami|bnn|default|enochian|hak|klingon|lux|mingo|navajo|pwn|tao|tay|tsu)'
                  + '|sgn-(?:BE-FR|BE-NL|CH-DE))',

        // regular       = "art-lojban"        ; these tags match the 'langtag'
        //               / "cel-gaulish"       ; production, but their subtags
        //               / "no-bok"            ; are not extended language
        //               / "no-nyn"            ; or variant subtags: their meaning
        //               / "zh-guoyu"          ; is defined by their registration
        //               / "zh-hakka"          ; and all of these are deprecated
        //               / "zh-min"            ; in favor of a more modern
        //               / "zh-min-nan"        ; subtag or sequence of subtags
        //               / "zh-xiang"
        regular = '(?:art-lojban|cel-gaulish|no-bok|no-nyn'
                + '|zh-(?:guoyu|hakka|min|min-nan|xiang))',

        // grandfathered = irregular           ; non-redundant tags registered
        //               / regular             ; during the RFC 3066 era
        grandfathered = '(?:' + irregular + '|' + regular + ')',

        // langtag       = language
        //                 ["-" script]
        //                 ["-" region]
        //                 *("-" variant)
        //                 *("-" extension)
        //                 ["-" privateuse]
        langtag = language + '(?:-' + script + ')?(?:-' + region + ')?(?:-'
                + variant + ')*(?:-' + extension + ')*(?:-' + privateuse + ')?';

    // Language-Tag  = langtag             ; normal language tags
    //               / privateuse          ; private use tag
    //               / grandfathered       ; grandfathered tags
    expBCP47Syntax = RegExp('^(?:'+langtag+'|'+privateuse+'|'+grandfathered+')$', 'i');

    // Match duplicate variants in a language tag
    expVariantDupes = RegExp('^(?!x).*?-('+variant+')-(?:\\w{4,8}-(?!x-))*\\1\\b', 'i');

    // Match duplicate singletons in a language tag (except in private use)
    expSingletonDupes = RegExp('^(?!x).*?-('+singleton+')-(?:\\w+-(?!x-))*\\1\\b', 'i');

    // Match all extension sequences
    expExtSequences = RegExp('-'+extension, 'ig');
})();

// Sect 6.2 Language Tags
// ======================

/**
 * The IsStructurallyValidLanguageTag abstract operation verifies that the locale
 * argument (which must be a String value)
 *
 * - represents a well-formed BCP 47 language tag as specified in RFC 5646 section
 *   2.1, or successor,
 * - does not include duplicate variant subtags, and
 * - does not include duplicate singleton subtags.
 *
 * The abstract operation returns true if locale can be generated from the ABNF
 * grammar in section 2.1 of the RFC, starting with Language-Tag, and does not
 * contain duplicate variant or singleton subtags (other than as a private use
 * subtag). It returns false otherwise. Terminal value characters in the grammar are
 * interpreted as the Unicode equivalents of the ASCII octet values given.
 */
function /* 6.2.2 */IsStructurallyValidLanguageTag(locale) {
    // represents a well-formed BCP 47 language tag as specified in RFC 5646
    if (!expBCP47Syntax.test(locale))
        return false;

    // does not include duplicate variant subtags, and
    if (expVariantDupes.test(locale))
        return false;

    // does not include duplicate singleton subtags.
    if (expSingletonDupes.test(locale))
        return false;

    return true;
}

/**
 * The CanonicalizeLanguageTag abstract operation returns the canonical and case-
 * regularized form of the locale argument (which must be a String value that is
 * a structurally valid BCP 47 language tag as verified by the
 * IsStructurallyValidLanguageTag abstract operation). It takes the steps
 * specified in RFC 5646 section 4.5, or successor, to bring the language tag
 * into canonical form, and to regularize the case of the subtags, but does not
 * take the steps to bring a language tag into “extlang form” and to reorder
 * variant subtags.

 * The specifications for extensions to BCP 47 language tags, such as RFC 6067,
 * may include canonicalization rules for the extension subtag sequences they
 * define that go beyond the canonicalization rules of RFC 5646 section 4.5.
 * Implementations are allowed, but not required, to apply these additional rules.
 */
function /* 6.2.3 */CanonicalizeLanguageTag (locale) {
    var match, parts;

    // A language tag is in 'canonical form' when the tag is well-formed
    // according to the rules in Sections 2.1 and 2.2

    // Section 2.1 says all subtags use lowercase...
    locale = locale.toLowerCase();

    // ...with 2 exceptions: 'two-letter and four-letter subtags that neither
    // appear at the start of the tag nor occur after singletons.  Such two-letter
    // subtags are all uppercase (as in the tags "en-CA-x-ca" or "sgn-BE-FR") and
    // four-letter subtags are titlecase (as in the tag "az-Latn-x-latn").
    parts = locale.split('-');
    for (var i = 1, max = parts.length; i < max; i++) {
        // Two-letter subtags are all uppercase
        if (parts[i].length === 2)
            parts[i] = parts[i].toUpperCase();

        // Four-letter subtags are titlecase
        else if (parts[i].length === 4)
            parts[i] = parts[i].charAt(0).toUpperCase() + parts[i].slice(1);

        // Is it a singleton?
        else if (parts[i].length === 1 && parts[i] != 'x')
            break;
    }
    locale = arrJoin.call(parts, '-');

    // The steps laid out in RFC 5646 section 4.5 are as follows:

    // 1.  Extension sequences are ordered into case-insensitive ASCII order
    //     by singleton subtag.
    if ((match = locale.match(expExtSequences)) && match.length > 1) {
        // The built-in sort() sorts by ASCII order, so use that
        match.sort();

        // Replace all extensions with the joined, sorted array
        locale = locale.replace(
            RegExp('(?:' + expExtSequences.source + ')+', 'i'),
            arrJoin.call(match, '')
        );
    }

    // 2.  Redundant or grandfathered tags are replaced by their 'Preferred-
    //     Value', if there is one.
    if (hop.call(redundantTags.tags, locale))
        locale = redundantTags.tags[locale];

    // 3.  Subtags are replaced by their 'Preferred-Value', if there is one.
    //     For extlangs, the original primary language subtag is also
    //     replaced if there is a primary language subtag in the 'Preferred-
    //     Value'.
    parts = locale.split('-');

    for (var i = 1, max = parts.length; i < max; i++) {
        if (hop.call(redundantTags.subtags, parts[i]))
            parts[i] = redundantTags.subtags[parts[i]];

        else if (hop.call(redundantTags.extLang, parts[i])) {
            parts[i] = redundantTags.extLang[parts[i]][0];

            // For extlang tags, the prefix needs to be removed if it is redundant
            if (i === 1 && redundantTags.extLang[parts[1]][1] === parts[0]) {
                parts = arrSlice.call(parts, i++);
                max -= 1;
            }
        }
    }

    return arrJoin.call(parts, '-');
}

/**
 * The DefaultLocale abstract operation returns a String value representing the
 * structurally valid (6.2.2) and canonicalized (6.2.3) BCP 47 language tag for the
 * host environment’s current locale.
 */
function /* 6.2.4 */DefaultLocale () {
    return defaultLocale;
}

// Sect 6.3 Currency Codes
// =======================

/**
 * The IsWellFormedCurrencyCode abstract operation verifies that the currency argument
 * (after conversion to a String value) represents a well-formed 3-letter ISO currency
 * code. The following steps are taken:
 */
function /* 6.3.1 */IsWellFormedCurrencyCode(currency) {
    var
        // 1. Let `c` be ToString(currency)
        c = String(currency),

        // 2. Let `normalized` be the result of mapping c to upper case as described
        //    in 6.1.
        normalized = toLatinUpperCase(c);

    // 3. If the string length of normalized is not 3, return false.
    // 4. If normalized contains any character that is not in the range "A" to "Z"
    //    (U+0041 to U+005A), return false.
    if (expCurrencyCode.test(normalized) === false)
        return false;

    // 5. Return true
    return true;
}

// Sect 9.2 Abstract Operations
// ============================
function /* 9.2.1 */CanonicalizeLocaleList (locales) {
// The abstract operation CanonicalizeLocaleList takes the following steps:

    // 1. If locales is undefined, then a. Return a new empty List
    if (locales === undefined)
        return new List();

    var
        // 2. Let seen be a new empty List.
        seen = new List(),

        // 3. If locales is a String value, then
        //    a. Let locales be a new array created as if by the expression new
        //    Array(locales) where Array is the standard built-in constructor with
        //    that name and locales is the value of locales.
        locales = typeof locales === 'string' ? [ locales ] : locales,

        // 4. Let O be ToObject(locales).
        O = toObject(locales),

        // 5. Let lenValue be the result of calling the [[Get]] internal method of
        //    O with the argument "length".
        // 6. Let len be ToUint32(lenValue).
        len = O.length,

        // 7. Let k be 0.
        k = 0;

    // 8. Repeat, while k < len
    while (k < len) {
        var
            // a. Let Pk be ToString(k).
            Pk = String(k),

            // b. Let kPresent be the result of calling the [[HasProperty]] internal
            //    method of O with argument Pk.
            kPresent = Pk in O;

        // c. If kPresent is true, then
        if (kPresent) {
            var
                // i. Let kValue be the result of calling the [[Get]] internal
                //     method of O with argument Pk.
                kValue = O[Pk];

            // ii. If the type of kValue is not String or Object, then throw a
            //     TypeError exception.
            if (kValue == null || (typeof kValue !== 'string' && typeof kValue !== 'object'))
                throw new TypeError('String or Object type expected');

            var
                // iii. Let tag be ToString(kValue).
                tag = String(kValue);

            // iv. If the result of calling the abstract operation
            //     IsStructurallyValidLanguageTag (defined in 6.2.2), passing tag as
            //     the argument, is false, then throw a RangeError exception.
            if (!IsStructurallyValidLanguageTag(tag))
                throw new RangeError("'" + tag + "' is not a structurally valid language tag");

            // v. Let tag be the result of calling the abstract operation
            //    CanonicalizeLanguageTag (defined in 6.2.3), passing tag as the
            //    argument.
            tag = CanonicalizeLanguageTag(tag);

            // vi. If tag is not an element of seen, then append tag as the last
            //     element of seen.
            if (arrIndexOf.call(seen, tag) === -1)
                arrPush.call(seen, tag);
        }

        // d. Increase k by 1.
        k++;
    }

    // 9. Return seen.
    return seen;
}

/**
 * The BestAvailableLocale abstract operation compares the provided argument
 * locale, which must be a String value with a structurally valid and
 * canonicalized BCP 47 language tag, against the locales in availableLocales and
 * returns either the longest non-empty prefix of locale that is an element of
 * availableLocales, or undefined if there is no such element. It uses the
 * fallback mechanism of RFC 4647, section 3.4. The following steps are taken:
 */
function /* 9.2.2 */BestAvailableLocale (availableLocales, locale) {
    var
       // 1. Let candidate be locale
       candidate = locale;

    // 2. Repeat
    while (true) {
        // a. If availableLocales contains an element equal to candidate, then return
        // candidate.
        if (arrIndexOf.call(availableLocales, candidate) > -1)
            return candidate;

        var
            // b. Let pos be the character index of the last occurrence of "-"
            // (U+002D) within candidate. If that character does not occur, return
            // undefined.
            pos = candidate.lastIndexOf('-');

        if (pos < 0)
            return;

        // c. If pos ≥ 2 and the character "-" occurs at index pos-2 of candidate,
        //    then decrease pos by 2.
        if (pos >= 2 && candidate.charAt(pos - 2) == '-')
            pos -= 2;

        // d. Let candidate be the substring of candidate from position 0, inclusive,
        //    to position pos, exclusive.
        candidate = candidate.substring(0, pos);
    }
}

/**
 * The LookupMatcher abstract operation compares requestedLocales, which must be
 * a List as returned by CanonicalizeLocaleList, against the locales in
 * availableLocales and determines the best available language to meet the
 * request. The following steps are taken:
 */
function /* 9.2.3 */LookupMatcher (availableLocales, requestedLocales) {
    var
        // 1. Let i be 0.
        i = 0,

        // 2. Let len be the number of elements in requestedLocales.
        len = requestedLocales.length,

        // 3. Let availableLocale be undefined.
        availableLocale;

    // 4. Repeat while i < len and availableLocale is undefined:
    while (i < len && !availableLocale) {
        var
            // a. Let locale be the element of requestedLocales at 0-origined list
            //    position i.
            locale = requestedLocales[i],

            // b. Let noExtensionsLocale be the String value that is locale with all
            //    Unicode locale extension sequences removed.
            noExtensionsLocale = String(locale).replace(expUnicodeExSeq, ''),

            // c. Let availableLocale be the result of calling the
            //    BestAvailableLocale abstract operation (defined in 9.2.2) with
            //    arguments availableLocales and noExtensionsLocale.
            availableLocale = BestAvailableLocale(availableLocales, noExtensionsLocale);

        // d. Increase i by 1.
        i++;
    }

    var
        // 5. Let result be a new Record.
        result = new Record();

    // 6. If availableLocale is not undefined, then
    if (availableLocale !== undefined) {
        // a. Set result.[[locale]] to availableLocale.
        result['[[locale]]'] = availableLocale;

        // b. If locale and noExtensionsLocale are not the same String value, then
        if (String(locale) !== String(noExtensionsLocale)) {
            var
                // i. Let extension be the String value consisting of the first
                //    substring of locale that is a Unicode locale extension sequence.
                extension = locale.match(expUnicodeExSeq)[0],

                // ii. Let extensionIndex be the character position of the initial
                //     "-" of the first Unicode locale extension sequence within locale.
                extensionIndex = locale.indexOf('-u-');

            // iii. Set result.[[extension]] to extension.
            result['[[extension]]'] = extension;

            // iv. Set result.[[extensionIndex]] to extensionIndex.
            result['[[extensionIndex]]'] = extensionIndex;
        }
    }
    // 7. Else
    else
        // a. Set result.[[locale]] to the value returned by the DefaultLocale abstract
        //    operation (defined in 6.2.4).
        result['[[locale]]'] = DefaultLocale();

    // 8. Return result
    return result;
}

/**
 * The BestFitMatcher abstract operation compares requestedLocales, which must be
 * a List as returned by CanonicalizeLocaleList, against the locales in
 * availableLocales and determines the best available language to meet the
 * request. The algorithm is implementation dependent, but should produce results
 * that a typical user of the requested locales would perceive as at least as
 * good as those produced by the LookupMatcher abstract operation. Options
 * specified through Unicode locale extension sequences must be ignored by the
 * algorithm. Information about such subsequences is returned separately.
 * The abstract operation returns a record with a [[locale]] field, whose value
 * is the language tag of the selected locale, which must be an element of
 * availableLocales. If the language tag of the request locale that led to the
 * selected locale contained a Unicode locale extension sequence, then the
 * returned record also contains an [[extension]] field whose value is the first
 * Unicode locale extension sequence, and an [[extensionIndex]] field whose value
 * is the index of the first Unicode locale extension sequence within the request
 * locale language tag.
 */
function /* 9.2.4 */BestFitMatcher (availableLocales, requestedLocales) {
    return LookupMatcher(availableLocales, requestedLocales);
}

/**
 * The ResolveLocale abstract operation compares a BCP 47 language priority list
 * requestedLocales against the locales in availableLocales and determines the
 * best available language to meet the request. availableLocales and
 * requestedLocales must be provided as List values, options as a Record.
 */
function /* 9.2.5 */ResolveLocale (availableLocales, requestedLocales, options, relevantExtensionKeys, localeData) {
    if (availableLocales.length === 0) {
        throw new ReferenceError('No locale data has been provided for this object yet.');
    }

    // The following steps are taken:
    var
        // 1. Let matcher be the value of options.[[localeMatcher]].
        matcher = options['[[localeMatcher]]'];

    // 2. If matcher is "lookup", then
    if (matcher === 'lookup')
        var
            // a. Let r be the result of calling the LookupMatcher abstract operation
            //    (defined in 9.2.3) with arguments availableLocales and
            //    requestedLocales.
            r = LookupMatcher(availableLocales, requestedLocales);

    // 3. Else
    else
        var
            // a. Let r be the result of calling the BestFitMatcher abstract
            //    operation (defined in 9.2.4) with arguments availableLocales and
            //    requestedLocales.
            r = BestFitMatcher(availableLocales, requestedLocales);

    var
        // 4. Let foundLocale be the value of r.[[locale]].
        foundLocale = r['[[locale]]'];

    // 5. If r has an [[extension]] field, then
    if (hop.call(r, '[[extension]]'))
        var
            // a. Let extension be the value of r.[[extension]].
            extension = r['[[extension]]'],
            // b. Let extensionIndex be the value of r.[[extensionIndex]].
            extensionIndex = r['[[extensionIndex]]'],
            // c. Let split be the standard built-in function object defined in ES5,
            //    15.5.4.14.
            split = String.prototype.split,
            // d. Let extensionSubtags be the result of calling the [[Call]] internal
            //    method of split with extension as the this value and an argument
            //    list containing the single item "-".
            extensionSubtags = split.call(extension, '-'),
            // e. Let extensionSubtagsLength be the result of calling the [[Get]]
            //    internal method of extensionSubtags with argument "length".
            extensionSubtagsLength = extensionSubtags.length;

    var
        // 6. Let result be a new Record.
        result = new Record();

    // 7. Set result.[[dataLocale]] to foundLocale.
    result['[[dataLocale]]'] = foundLocale;

    var
        // 8. Let supportedExtension be "-u".
        supportedExtension = '-u',
        // 9. Let i be 0.
        i = 0,
        // 10. Let len be the result of calling the [[Get]] internal method of
        //     relevantExtensionKeys with argument "length".
        len = relevantExtensionKeys.length;

    // 11 Repeat while i < len:
    while (i < len) {
        var
            // a. Let key be the result of calling the [[Get]] internal method of
            //    relevantExtensionKeys with argument ToString(i).
            key = relevantExtensionKeys[i],
            // b. Let foundLocaleData be the result of calling the [[Get]] internal
            //    method of localeData with the argument foundLocale.
            foundLocaleData = localeData[foundLocale],
            // c. Let keyLocaleData be the result of calling the [[Get]] internal
            //    method of foundLocaleData with the argument key.
            keyLocaleData = foundLocaleData[key],
            // d. Let value be the result of calling the [[Get]] internal method of
            //    keyLocaleData with argument "0".
            value = keyLocaleData['0'],
            // e. Let supportedExtensionAddition be "".
            supportedExtensionAddition = '',
            // f. Let indexOf be the standard built-in function object defined in
            //    ES5, 15.4.4.14.
            indexOf = arrIndexOf;

        // g. If extensionSubtags is not undefined, then
        if (extensionSubtags !== undefined) {
            var
                // i. Let keyPos be the result of calling the [[Call]] internal
                //    method of indexOf with extensionSubtags as the this value and
                // an argument list containing the single item key.
                keyPos = indexOf.call(extensionSubtags, key);

            // ii. If keyPos ≠ -1, then
            if (keyPos !== -1) {
                // 1. If keyPos + 1 < extensionSubtagsLength and the length of the
                //    result of calling the [[Get]] internal method of
                //    extensionSubtags with argument ToString(keyPos +1) is greater
                //    than 2, then
                if (keyPos + 1 < extensionSubtagsLength
                        && extensionSubtags[keyPos + 1].length > 2) {
                    var
                        // a. Let requestedValue be the result of calling the [[Get]]
                        //    internal method of extensionSubtags with argument
                        //    ToString(keyPos + 1).
                        requestedValue = extensionSubtags[keyPos + 1],
                        // b. Let valuePos be the result of calling the [[Call]]
                        //    internal method of indexOf with keyLocaleData as the
                        //    this value and an argument list containing the single
                        //    item requestedValue.
                        valuePos = indexOf.call(keyLocaleData, requestedValue);

                    // c. If valuePos ≠ -1, then
                    if (valuePos !== -1)
                        var
                            // i. Let value be requestedValue.
                            value = requestedValue,
                            // ii. Let supportedExtensionAddition be the
                            //     concatenation of "-", key, "-", and value.
                            supportedExtensionAddition = '-' + key + '-' + value;
                }
                // 2. Else
                else {
                    var
                        // a. Let valuePos be the result of calling the [[Call]]
                        // internal method of indexOf with keyLocaleData as the this
                        // value and an argument list containing the single item
                        // "true".
                        valuePos = indexOf(keyLocaleData, 'true');

                    // b. If valuePos ≠ -1, then
                    if (valuePos !== -1)
                        var
                            // i. Let value be "true".
                            value = 'true';
                }
            }
        }
        // h. If options has a field [[<key>]], then
        if (hop.call(options, '[[' + key + ']]')) {
            var
                // i. Let optionsValue be the value of options.[[<key>]].
                optionsValue = options['[[' + key + ']]'];

            // ii. If the result of calling the [[Call]] internal method of indexOf
            //     with keyLocaleData as the this value and an argument list
            //     containing the single item optionsValue is not -1, then
            if (indexOf.call(keyLocaleData, optionsValue) !== -1) {
                // 1. If optionsValue is not equal to value, then
                if (optionsValue !== value) {
                    // a. Let value be optionsValue.
                    value = optionsValue;
                    // b. Let supportedExtensionAddition be "".
                    supportedExtensionAddition = '';
                }
            }
        }
        // i. Set result.[[<key>]] to value.
        result['[[' + key + ']]'] = value;

        // j. Append supportedExtensionAddition to supportedExtension.
        supportedExtension += supportedExtensionAddition;

        // k. Increase i by 1.
        i++;
    }
    // 12. If the length of supportedExtension is greater than 2, then
    if (supportedExtension.length > 2) {
        var
            // a. Let preExtension be the substring of foundLocale from position 0,
            //    inclusive, to position extensionIndex, exclusive.
            preExtension = foundLocale.substring(0, extensionIndex),
            // b. Let postExtension be the substring of foundLocale from position
            //    extensionIndex to the end of the string.
            postExtension = foundLocale.substring(extensionIndex),
            // c. Let foundLocale be the concatenation of preExtension,
            //    supportedExtension, and postExtension.
            foundLocale = preExtension + supportedExtension + postExtension;
    }
    // 13. Set result.[[locale]] to foundLocale.
    result['[[locale]]'] = foundLocale;

    // 14. Return result.
    return result;
}

/**
 * The LookupSupportedLocales abstract operation returns the subset of the
 * provided BCP 47 language priority list requestedLocales for which
 * availableLocales has a matching locale when using the BCP 47 Lookup algorithm.
 * Locales appear in the same order in the returned list as in requestedLocales.
 * The following steps are taken:
 */
function /* 9.2.6 */LookupSupportedLocales (availableLocales, requestedLocales) {
    var
        // 1. Let len be the number of elements in requestedLocales.
        len = requestedLocales.length,
        // 2. Let subset be a new empty List.
        subset = new List(),
        // 3. Let k be 0.
        k = 0;

    // 4. Repeat while k < len
    while (k < len) {
        var
            // a. Let locale be the element of requestedLocales at 0-origined list
            //    position k.
            locale = requestedLocales[k],
            // b. Let noExtensionsLocale be the String value that is locale with all
            //    Unicode locale extension sequences removed.
            noExtensionsLocale = String(locale).replace(expUnicodeExSeq, ''),
            // c. Let availableLocale be the result of calling the
            //    BestAvailableLocale abstract operation (defined in 9.2.2) with
            //    arguments availableLocales and noExtensionsLocale.
            availableLocale = BestAvailableLocale(availableLocales, noExtensionsLocale);

        // d. If availableLocale is not undefined, then append locale to the end of
        //    subset.
        if (availableLocale !== undefined)
            arrPush.call(subset, locale);

        // e. Increment k by 1.
        k++;
    }

    var
        // 5. Let subsetArray be a new Array object whose elements are the same
        //    values in the same order as the elements of subset.
        subsetArray = arrSlice.call(subset);

    // 6. Return subsetArray.
    return subsetArray;
}

/**
 * The BestFitSupportedLocales abstract operation returns the subset of the
 * provided BCP 47 language priority list requestedLocales for which
 * availableLocales has a matching locale when using the Best Fit Matcher
 * algorithm. Locales appear in the same order in the returned list as in
 * requestedLocales. The steps taken are implementation dependent.
 */
function /*9.2.7 */BestFitSupportedLocales (availableLocales, requestedLocales) {
    // ###TODO: implement this function as described by the specification###
    return LookupSupportedLocales(availableLocales, requestedLocales);
}

/**
 * The SupportedLocales abstract operation returns the subset of the provided BCP
 * 47 language priority list requestedLocales for which availableLocales has a
 * matching locale. Two algorithms are available to match the locales: the Lookup
 * algorithm described in RFC 4647 section 3.4, and an implementation dependent
 * best-fit algorithm. Locales appear in the same order in the returned list as
 * in requestedLocales. The following steps are taken:
 */
function /*9.2.8 */SupportedLocales (availableLocales, requestedLocales, options) {
    // 1. If options is not undefined, then
    if (options !== undefined) {
        var
            // a. Let options be ToObject(options).
            options = new Record(toObject(options)),
            // b. Let matcher be the result of calling the [[Get]] internal method of
            //    options with argument "localeMatcher".
            matcher = options.localeMatcher;

        // c. If matcher is not undefined, then
        if (matcher !== undefined) {
            // i. Let matcher be ToString(matcher).
            matcher = String(matcher);

            // ii. If matcher is not "lookup" or "best fit", then throw a RangeError
            //     exception.
            if (matcher !== 'lookup' && matcher !== 'best fit')
                throw new RangeError('matcher should be "lookup" or "best fit"');
        }
    }
    // 2. If matcher is undefined or "best fit", then
    if (matcher === undefined || matcher === 'best fit')
        var
            // a. Let subset be the result of calling the BestFitSupportedLocales
            //    abstract operation (defined in 9.2.7) with arguments
            //    availableLocales and requestedLocales.
            subset = BestFitSupportedLocales(availableLocales, requestedLocales);
    // 3. Else
    else
        var
            // a. Let subset be the result of calling the LookupSupportedLocales
            //    abstract operation (defined in 9.2.6) with arguments
            //    availableLocales and requestedLocales.
            subset = LookupSupportedLocales(availableLocales, requestedLocales);

    // 4. For each named own property name P of subset,
    for (var P in subset) {
        if (!hop.call(subset, P))
            continue;

        // a. Let desc be the result of calling the [[GetOwnProperty]] internal
        //    method of subset with P.
        // b. Set desc.[[Writable]] to false.
        // c. Set desc.[[Configurable]] to false.
        // d. Call the [[DefineOwnProperty]] internal method of subset with P, desc,
        //    and true as arguments.
        defineProperty(subset, P, {
            writable: false, configurable: false, value: subset[P]
        });
    }
    // "Freeze" the array so no new elements can be added
    defineProperty(subset, 'length', { writable: false });

    // 5. Return subset
    return subset;
}

/**
 * The GetOption abstract operation extracts the value of the property named
 * property from the provided options object, converts it to the required type,
 * checks whether it is one of a List of allowed values, and fills in a fallback
 * value if necessary.
 */
function /*9.2.9 */GetOption (options, property, type, values, fallback) {
    var
        // 1. Let value be the result of calling the [[Get]] internal method of
        //    options with argument property.
        value = options[property];

    // 2. If value is not undefined, then
    if (value !== undefined) {
        // a. Assert: type is "boolean" or "string".
        // b. If type is "boolean", then let value be ToBoolean(value).
        // c. If type is "string", then let value be ToString(value).
        value = type === 'boolean' ? Boolean(value)
                  : (type === 'string' ? String(value) : value);

        // d. If values is not undefined, then
        if (values !== undefined) {
            // i. If values does not contain an element equal to value, then throw a
            //    RangeError exception.
            if (arrIndexOf.call(values, value) === -1)
                throw new RangeError("'" + value + "' is not an allowed value for `" + property +'`');
        }

        // e. Return value.
        return value;
    }
    // Else return fallback.
    return fallback;
}

/**
 * The GetNumberOption abstract operation extracts a property value from the
 * provided options object, converts it to a Number value, checks whether it is
 * in the allowed range, and fills in a fallback value if necessary.
 */
function /* 9.2.10 */GetNumberOption (options, property, minimum, maximum, fallback) {
    var
        // 1. Let value be the result of calling the [[Get]] internal method of
        //    options with argument property.
        value = options[property];

    // 2. If value is not undefined, then
    if (value !== undefined) {
        // a. Let value be ToNumber(value).
        value = Number(value);

        // b. If value is NaN or less than minimum or greater than maximum, throw a
        //    RangeError exception.
        if (isNaN(value) || value < minimum || value > maximum)
            throw new RangeError('Value is not a number or outside accepted range');

        // c. Return floor(value).
        return Math.floor(value);
    }
    // 3. Else return fallback.
    return fallback;
}

// 11.1 The Intl.NumberFormat constructor
// ======================================

// Define the NumberFormat constructor internally so it cannot be tainted
function NumberFormatConstructor () {
    var locales = arguments[0];
    var options = arguments[1];

    if (!this || this === Intl) {
        return new Intl.NumberFormat(locales, options);
    }

    return InitializeNumberFormat(toObject(this), locales, options);
}

defineProperty(Intl, 'NumberFormat', {
    configurable: true,
    writable: true,
    value: NumberFormatConstructor
});

// Must explicitly set prototypes as unwritable
defineProperty(Intl.NumberFormat, 'prototype', {
    writable: false
});

/**
 * The abstract operation InitializeNumberFormat accepts the arguments
 * numberFormat (which must be an object), locales, and options. It initializes
 * numberFormat as a NumberFormat object.
 */
function /*11.1.1.1 */InitializeNumberFormat (numberFormat, locales, options) {
    var
    // This will be a internal properties object if we're not already initialized
        internal = getInternalProperties(numberFormat),

    // Create an object whose props can be used to restore the values of RegExp props
        regexpState = createRegExpRestore();

    // 1. If numberFormat has an [[initializedIntlObject]] internal property with
    // value true, throw a TypeError exception.
    if (internal['[[initializedIntlObject]]'] === true)
        throw new TypeError('`this` object has already been initialized as an Intl object');

    // Need this to access the `internal` object
    defineProperty(numberFormat, '__getInternalProperties', {
        value: function () {
            // NOTE: Non-standard, for internal use only
            if (arguments[0] === secret)
                return internal;
        }
    });

    // 2. Set the [[initializedIntlObject]] internal property of numberFormat to true.
    internal['[[initializedIntlObject]]'] = true;

    var
    // 3. Let requestedLocales be the result of calling the CanonicalizeLocaleList
    //    abstract operation (defined in 9.2.1) with argument locales.
        requestedLocales = CanonicalizeLocaleList(locales);

    // 4. If options is undefined, then
    if (options === undefined)
        // a. Let options be the result of creating a new object as if by the
        // expression new Object() where Object is the standard built-in constructor
        // with that name.
        options = {};

    // 5. Else
    else
        // a. Let options be ToObject(options).
        options = toObject(options);

    var
    // 6. Let opt be a new Record.
        opt = new Record(),

    // 7. Let matcher be the result of calling the GetOption abstract operation
    //    (defined in 9.2.9) with the arguments options, "localeMatcher", "string",
    //    a List containing the two String values "lookup" and "best fit", and
    //    "best fit".
        matcher =  GetOption(options, 'localeMatcher', 'string', new List('lookup', 'best fit'), 'best fit');

    // 8. Set opt.[[localeMatcher]] to matcher.
    opt['[[localeMatcher]]'] = matcher;

    var
    // 9. Let NumberFormat be the standard built-in object that is the initial value
    //    of Intl.NumberFormat.
    // 10. Let localeData be the value of the [[localeData]] internal property of
    //     NumberFormat.
        localeData = internals.NumberFormat['[[localeData]]'],

    // 11. Let r be the result of calling the ResolveLocale abstract operation
    //     (defined in 9.2.5) with the [[availableLocales]] internal property of
    //     NumberFormat, requestedLocales, opt, the [[relevantExtensionKeys]]
    //     internal property of NumberFormat, and localeData.
        r = ResolveLocale(
                internals.NumberFormat['[[availableLocales]]'], requestedLocales,
                opt, internals.NumberFormat['[[relevantExtensionKeys]]'], localeData
            );

    // 12. Set the [[locale]] internal property of numberFormat to the value of
    //     r.[[locale]].
    internal['[[locale]]'] = r['[[locale]]'];

    // 13. Set the [[numberingSystem]] internal property of numberFormat to the value
    //     of r.[[nu]].
    internal['[[numberingSystem]]'] = r['[[nu]]'];

    // The specification doesn't tell us to do this, but it's helpful later on
    internal['[[dataLocale]]'] = r['[[dataLocale]]'];

    var
    // 14. Let dataLocale be the value of r.[[dataLocale]].
        dataLocale = r['[[dataLocale]]'],

    // 15. Let s be the result of calling the GetOption abstract operation with the
    //     arguments options, "style", "string", a List containing the three String
    //     values "decimal", "percent", and "currency", and "decimal".
        s = GetOption(options, 'style', 'string', new List('decimal', 'percent', 'currency'), 'decimal');

    // 16. Set the [[style]] internal property of numberFormat to s.
    internal['[[style]]'] = s;

    var
    // 17. Let c be the result of calling the GetOption abstract operation with the
    //     arguments options, "currency", "string", undefined, and undefined.
        c = GetOption(options, 'currency', 'string');

    // 18. If c is not undefined and the result of calling the
    //     IsWellFormedCurrencyCode abstract operation (defined in 6.3.1) with
    //     argument c is false, then throw a RangeError exception.
    if (c !== undefined && !IsWellFormedCurrencyCode(c))
        throw new RangeError("'" + c + "' is not a valid currency code");

    // 19. If s is "currency" and c is undefined, throw a TypeError exception.
    if (s === 'currency' && c === undefined)
        throw new TypeError('Currency code is required when style is currency');

    // 20. If s is "currency", then
    if (s === 'currency') {
        // a. Let c be the result of converting c to upper case as specified in 6.1.
        c = c.toUpperCase();

        // b. Set the [[currency]] internal property of numberFormat to c.
        internal['[[currency]]'] = c;

        var
        // c. Let cDigits be the result of calling the CurrencyDigits abstract
        //    operation (defined below) with argument c.
            cDigits = CurrencyDigits(c);
    }

    var
    // 21. Let cd be the result of calling the GetOption abstract operation with the
    //     arguments options, "currencyDisplay", "string", a List containing the
    //     three String values "code", "symbol", and "name", and "symbol".
        cd = GetOption(options, 'currencyDisplay', 'string', new List('code', 'symbol', 'name'), 'symbol');

    // 22. If s is "currency", then set the [[currencyDisplay]] internal property of
    //     numberFormat to cd.
    if (s === 'currency')
        internal['[[currencyDisplay]]'] = cd;

    var
    // 23. Let mnid be the result of calling the GetNumberOption abstract operation
    //     (defined in 9.2.10) with arguments options, "minimumIntegerDigits", 1, 21,
    //     and 1.
        mnid = GetNumberOption(options, 'minimumIntegerDigits', 1, 21, 1);

    // 24. Set the [[minimumIntegerDigits]] internal property of numberFormat to mnid.
    internal['[[minimumIntegerDigits]]'] = mnid;

    var
    // 25. If s is "currency", then let mnfdDefault be cDigits; else let mnfdDefault
    //     be 0.
        mnfdDefault = s === 'currency' ? cDigits : 0,

    // 26. Let mnfd be the result of calling the GetNumberOption abstract operation
    //     with arguments options, "minimumFractionDigits", 0, 20, and mnfdDefault.
        mnfd = GetNumberOption(options, 'minimumFractionDigits', 0, 20, mnfdDefault);

    // 27. Set the [[minimumFractionDigits]] internal property of numberFormat to mnfd.
    internal['[[minimumFractionDigits]]'] = mnfd;

    var
    // 28. If s is "currency", then let mxfdDefault be max(mnfd, cDigits); else if s
    //     is "percent", then let mxfdDefault be max(mnfd, 0); else let mxfdDefault
    //     be max(mnfd, 3).
        mxfdDefault = s === 'currency' ? Math.max(mnfd, cDigits)
                    : (s === 'percent' ? Math.max(mnfd, 0) : Math.max(mnfd, 3)),

    // 29. Let mxfd be the result of calling the GetNumberOption abstract operation
    //     with arguments options, "maximumFractionDigits", mnfd, 20, and mxfdDefault.
        mxfd = GetNumberOption(options, 'maximumFractionDigits', mnfd, 20, mxfdDefault);

    // 30. Set the [[maximumFractionDigits]] internal property of numberFormat to mxfd.
    internal['[[maximumFractionDigits]]'] = mxfd;

    var
    // 31. Let mnsd be the result of calling the [[Get]] internal method of options
    //     with argument "minimumSignificantDigits".
        mnsd = options.minimumSignificantDigits,

    // 32. Let mxsd be the result of calling the [[Get]] internal method of options
    //     with argument "maximumSignificantDigits".
        mxsd = options.maximumSignificantDigits;

    // 33. If mnsd is not undefined or mxsd is not undefined, then:
    if (mnsd !== undefined || mxsd !== undefined) {
        // a. Let mnsd be the result of calling the GetNumberOption abstract
        //    operation with arguments options, "minimumSignificantDigits", 1, 21,
        //    and 1.
        mnsd = GetNumberOption(options, 'minimumSignificantDigits', 1, 21, 1);

        // b. Let mxsd be the result of calling the GetNumberOption abstract
        //     operation with arguments options, "maximumSignificantDigits", mnsd,
        //     21, and 21.
        mxsd = GetNumberOption(options, 'maximumSignificantDigits', mnsd, 21, 21);

        // c. Set the [[minimumSignificantDigits]] internal property of numberFormat
        //    to mnsd, and the [[maximumSignificantDigits]] internal property of
        //    numberFormat to mxsd.
        internal['[[minimumSignificantDigits]]'] = mnsd;
        internal['[[maximumSignificantDigits]]'] = mxsd;
    }
    var
    // 34. Let g be the result of calling the GetOption abstract operation with the
    //     arguments options, "useGrouping", "boolean", undefined, and true.
        g = GetOption(options, 'useGrouping', 'boolean', undefined, true);

    // 35. Set the [[useGrouping]] internal property of numberFormat to g.
    internal['[[useGrouping]]'] = g;

    var
    // 36. Let dataLocaleData be the result of calling the [[Get]] internal method of
    //     localeData with argument dataLocale.
        dataLocaleData = localeData[dataLocale],

    // 37. Let patterns be the result of calling the [[Get]] internal method of
    //     dataLocaleData with argument "patterns".
        patterns = dataLocaleData.patterns;

    // 38. Assert: patterns is an object (see 11.2.3)

    var
    // 39. Let stylePatterns be the result of calling the [[Get]] internal method of
    //     patterns with argument s.
        stylePatterns = patterns[s];

    // 40. Set the [[positivePattern]] internal property of numberFormat to the
    //     result of calling the [[Get]] internal method of stylePatterns with the
    //     argument "positivePattern".
    internal['[[positivePattern]]'] = stylePatterns.positivePattern;

    // 41. Set the [[negativePattern]] internal property of numberFormat to the
    //     result of calling the [[Get]] internal method of stylePatterns with the
    //     argument "negativePattern".
    internal['[[negativePattern]]'] = stylePatterns.negativePattern;

    // 42. Set the [[boundFormat]] internal property of numberFormat to undefined.
    internal['[[boundFormat]]'] = undefined;

    // 43. Set the [[initializedNumberFormat]] internal property of numberFormat to
    //     true.
    internal['[[initializedNumberFormat]]'] = true;

    // In ES3, we need to pre-bind the format() function
    if (es3)
        numberFormat.format = GetFormatNumber.call(numberFormat);

    // Restore the RegExp properties
    regexpState.exp.test(regexpState.input);

    // Return the newly initialised object
    return numberFormat;
}

function CurrencyDigits(currency) {
    // When the CurrencyDigits abstract operation is called with an argument currency
    // (which must be an upper case String value), the following steps are taken:

    // 1. If the ISO 4217 currency and funds code list contains currency as an
    // alphabetic code, then return the minor unit value corresponding to the
    // currency from the list; else return 2.
    return currencyMinorUnits[currency] !== undefined
                ? currencyMinorUnits[currency]
                : 2;
}

/* 11.2.3 */internals.NumberFormat = {
    '[[availableLocales]]': [],
    '[[relevantExtensionKeys]]': ['nu'],
    '[[localeData]]': {}
};

/**
 * When the supportedLocalesOf method of Intl.NumberFormat is called, the
 * following steps are taken:
 */
/* 11.2.2 */defineProperty(Intl.NumberFormat, 'supportedLocalesOf', {
    configurable: true,
    writable: true,
    value: fnBind.call(supportedLocalesOf, internals.NumberFormat)
});

/**
 * This named accessor property returns a function that formats a number
 * according to the effective locale and the formatting options of this
 * NumberFormat object.
 */
/* 11.3.2 */defineProperty(Intl.NumberFormat.prototype, 'format', {
    configurable: true,
    get: GetFormatNumber
});

function GetFormatNumber() {
        var internal = this != null && typeof this === 'object' && getInternalProperties(this);

        // Satisfy test 11.3_b
        if (!internal || !internal['[[initializedNumberFormat]]'])
            throw new TypeError('`this` value for format() is not an initialized Intl.NumberFormat object.');

        // The value of the [[Get]] attribute is a function that takes the following
        // steps:

        // 1. If the [[boundFormat]] internal property of this NumberFormat object
        //    is undefined, then:
        if (internal['[[boundFormat]]'] === undefined) {
            var
            // a. Let F be a Function object, with internal properties set as
            //    specified for built-in functions in ES5, 15, or successor, and the
            //    length property set to 1, that takes the argument value and
            //    performs the following steps:
                F = function (value) {
                    // i. If value is not provided, then let value be undefined.
                    // ii. Let x be ToNumber(value).
                    // iii. Return the result of calling the FormatNumber abstract
                    //      operation (defined below) with arguments this and x.
                    return FormatNumber(this, /* x = */Number(value));
                },

            // b. Let bind be the standard built-in function object defined in ES5,
            //    15.3.4.5.
            // c. Let bf be the result of calling the [[Call]] internal method of
            //    bind with F as the this value and an argument list containing
            //    the single item this.
                bf = fnBind.call(F, this);

            // d. Set the [[boundFormat]] internal property of this NumberFormat
            //    object to bf.
            internal['[[boundFormat]]'] = bf;
        }
        // Return the value of the [[boundFormat]] internal property of this
        // NumberFormat object.
        return internal['[[boundFormat]]'];
    }

/**
 * When the FormatNumber abstract operation is called with arguments numberFormat
 * (which must be an object initialized as a NumberFormat) and x (which must be a
 * Number value), it returns a String value representing x according to the
 * effective locale and the formatting options of numberFormat.
 */
function FormatNumber (numberFormat, x) {
    var n,

    // Create an object whose props can be used to restore the values of RegExp props
        regexpState = createRegExpRestore(),

        internal = getInternalProperties(numberFormat),
        locale = internal['[[dataLocale]]'],
        nums   = internal['[[numberingSystem]]'],
        data   = internals.NumberFormat['[[localeData]]'][locale],
        ild    = data.symbols[nums] || data.symbols.latn,

    // 1. Let negative be false.
        negative = false;

    // 2. If the result of isFinite(x) is false, then
    if (isFinite(x) === false) {
        // a. If x is NaN, then let n be an ILD String value indicating the NaN value.
        if (isNaN(x))
            n = ild.nan;

        // b. Else
        else {
            // a. Let n be an ILD String value indicating infinity.
            n = ild.infinity;
            // b. If x < 0, then let negative be true.
            if (x < 0)
                negative = true;
        }
    }
    // 3. Else
    else {
        // a. If x < 0, then
        if (x < 0) {
            // i. Let negative be true.
            negative = true;
            // ii. Let x be -x.
            x = -x;
        }

        // b. If the value of the [[style]] internal property of numberFormat is
        //    "percent", let x be 100 × x.
        if (internal['[[style]]'] === 'percent')
            x *= 100;

        // c. If the [[minimumSignificantDigits]] and [[maximumSignificantDigits]]
        //    internal properties of numberFormat are present, then
        if (hop.call(internal, '[[minimumSignificantDigits]]') &&
                hop.call(internal, '[[maximumSignificantDigits]]'))
            // i. Let n be the result of calling the ToRawPrecision abstract operation
            //    (defined below), passing as arguments x and the values of the
            //    [[minimumSignificantDigits]] and [[maximumSignificantDigits]]
            //    internal properties of numberFormat.
            n = ToRawPrecision(x,
                  internal['[[minimumSignificantDigits]]'],
                  internal['[[maximumSignificantDigits]]']);
        // d. Else
        else
            // i. Let n be the result of calling the ToRawFixed abstract operation
            //    (defined below), passing as arguments x and the values of the
            //    [[minimumIntegerDigits]], [[minimumFractionDigits]], and
            //    [[maximumFractionDigits]] internal properties of numberFormat.
            n = ToRawFixed(x,
                  internal['[[minimumIntegerDigits]]'],
                  internal['[[minimumFractionDigits]]'],
                  internal['[[maximumFractionDigits]]']);

        // e. If the value of the [[numberingSystem]] internal property of
        //    numberFormat matches one of the values in the “Numbering System” column
        //    of Table 2 below, then
        if (numSys[nums]) {
            // i. Let digits be an array whose 10 String valued elements are the
            //    UTF-16 string representations of the 10 digits specified in the
            //    “Digits” column of Table 2 in the row containing the value of the
            //    [[numberingSystem]] internal property.
            var digits = numSys[internal['[[numberingSystem]]']];
            // ii. Replace each digit in n with the value of digits[digit].
            n = String(n).replace(/\d/g, function (digit) {
                return digits[digit];
            });
        }
        // f. Else use an implementation dependent algorithm to map n to the
        //    appropriate representation of n in the given numbering system.
        else
            n = String(n); // ###TODO###

        // g. If n contains the character ".", then replace it with an ILND String
        //    representing the decimal separator.
        n = n.replace(/\./g, ild.decimal);

        // h. If the value of the [[useGrouping]] internal property of numberFormat
        //    is true, then insert an ILND String representing a grouping separator
        //    into an ILND set of locations within the integer part of n.
        if (internal['[[useGrouping]]'] === true) {
            var
                parts  = n.split(ild.decimal),
                igr    = parts[0],

                // Primary group represents the group closest to the decimal
                pgSize = data.patterns.primaryGroupSize || 3,

                // Secondary group is every other group
                sgSize = data.patterns.secondaryGroupSize || pgSize;

            // Group only if necessary
            if (igr.length > pgSize) {
                var
                    groups = new List(),

                    // Index of the primary grouping separator
                    end    = igr.length - pgSize,

                    // Starting index for our loop
                    idx    = end % sgSize,

                    start  = igr.slice(0, idx);

                if (start.length)
                    arrPush.call(groups, start);

                // Loop to separate into secondary grouping digits
                while (idx < end) {
                    arrPush.call(groups, igr.slice(idx, idx + sgSize));
                    idx += sgSize;
                }

                // Add the primary grouping digits
                arrPush.call(groups, igr.slice(end));

                parts[0] = arrJoin.call(groups, ild.group);
            }

            n = arrJoin.call(parts, ild.decimal);
        }
    }

    var
    // 4. If negative is true, then let result be the value of the [[negativePattern]]
    //    internal property of numberFormat; else let result be the value of the
    //    [[positivePattern]] internal property of numberFormat.
        result = internal[negative === true ? '[[negativePattern]]' : '[[positivePattern]]'];

    // 5. Replace the substring "{number}" within result with n.
    result = result.replace('{number}', n);

    // 6. If the value of the [[style]] internal property of numberFormat is
    //    "currency", then:
    if (internal['[[style]]'] === 'currency') {
        var cd,
        // a. Let currency be the value of the [[currency]] internal property of
        //    numberFormat.
            currency = internal['[[currency]]'],

        // Shorthand for the currency data
            cData = data.currencies[currency];

        // b. If the value of the [[currencyDisplay]] internal property of
        //    numberFormat is "code", then let cd be currency.
        // c. Else if the value of the [[currencyDisplay]] internal property of
        //    numberFormat is "symbol", then let cd be an ILD string representing
        //    currency in short form. If the implementation does not have such a
        //    representation of currency, then use currency itself.
        // d. Else if the value of the [[currencyDisplay]] internal property of
        //    numberFormat is "name", then let cd be an ILD string representing
        //    currency in long form. If the implementation does not have such a
        //    representation of currency, then use currency itself.
        switch (internal['[[currencyDisplay]]']) {
            case 'symbol':
                cd = cData || currency;
                break;

            default:
            case 'code':
            case 'name':
                cd = currency;
        }

        // e. Replace the substring "{currency}" within result with cd.
        result = result.replace('{currency}', cd);
    }

    // Restore the RegExp properties
    regexpState.exp.test(regexpState.input);

    // 7. Return result.
    return result;
}

/**
 * When the ToRawPrecision abstract operation is called with arguments x (which
 * must be a finite non-negative number), minPrecision, and maxPrecision (both
 * must be integers between 1 and 21) the following steps are taken:
 */
function ToRawPrecision (x, minPrecision, maxPrecision) {
    var
    // 1. Let p be maxPrecision.
        p = maxPrecision;

    // 2. If x = 0, then
    if (x === 0) {
        var
        // a. Let m be the String consisting of p occurrences of the character "0".
            m = arrJoin.call(Array (p + 1), '0'),
        // b. Let e be 0.
            e = 0;
    }
    // 3. Else
    else {
        // a. Let e and n be integers such that 10ᵖ⁻¹ ≤ n < 10ᵖ and for which the
        //    exact mathematical value of n × 10ᵉ⁻ᵖ⁺¹ – x is as close to zero as
        //    possible. If there are two such sets of e and n, pick the e and n for
        //    which n × 10ᵉ⁻ᵖ⁺¹ is larger.
        var
            e = log10Floor(Math.abs(x)),

            // Easier to get to m from here
            f = Math.round(Math.exp((Math.abs(e - p + 1)) * Math.LN10)),

        // b. Let m be the String consisting of the digits of the decimal
        //    representation of n (in order, with no leading zeroes)
            m = String(Math.round(e - p + 1 < 0 ? x * f : x / f));
    }

    // 4. If e ≥ p, then
    if (e >= p)
        // a. Return the concatenation of m and e-p+1 occurrences of the character "0".
        return m + arrJoin.call(Array(e-p+1 + 1), '0');

    // 5. If e = p-1, then
    else if (e === p - 1)
        // a. Return m.
        return m;

    // 6. If e ≥ 0, then
    else if (e >= 0)
        // a. Let m be the concatenation of the first e+1 characters of m, the character
        //    ".", and the remaining p–(e+1) characters of m.
        m = m.slice(0, e + 1) + '.' + m.slice(e + 1);

    // 7. If e < 0, then
    else if (e < 0)
        // a. Let m be the concatenation of the String "0.", –(e+1) occurrences of the
        //    character "0", and the string m.
        m = '0.' + arrJoin.call(Array (-(e+1) + 1), '0') + m;

    // 8. If m contains the character ".", and maxPrecision > minPrecision, then
    if (m.indexOf(".") >= 0 && maxPrecision > minPrecision) {
        var
        // a. Let cut be maxPrecision – minPrecision.
            cut = maxPrecision - minPrecision;

        // b. Repeat while cut > 0 and the last character of m is "0":
        while (cut > 0 && m.charAt(m.length-1) === '0') {
            //  i. Remove the last character from m.
            m = m.slice(0, -1);

            //  ii. Decrease cut by 1.
            cut--;
        }

        // c. If the last character of m is ".", then
        if (m.charAt(m.length-1) === '.')
            //    i. Remove the last character from m.
            m = m.slice(0, -1);
    }
    // 9. Return m.
    return m;
}

/**
 * When the ToRawFixed abstract operation is called with arguments x (which must
 * be a finite non-negative number), minInteger (which must be an integer between
 * 1 and 21), minFraction, and maxFraction (which must be integers between 0 and
 * 20) the following steps are taken:
 */
function ToRawFixed (x, minInteger, minFraction, maxFraction) {
    // (or not because Number.toPrototype.toFixed does a lot of it for us)
    var idx,

        // We can pick up after the fixed formatted string (m) is created
        m   = Number.prototype.toFixed.call(x, maxFraction),

        // 4. If [maxFraction] ≠ 0, then
        //    ...
        //    e. Let int be the number of characters in a.
        //
        // 5. Else let int be the number of characters in m.
        igr = m.split(".")[0].length,  // int is a reserved word

        // 6. Let cut be maxFraction – minFraction.
        cut = maxFraction - minFraction,

        exp = (idx = m.indexOf('e')) > -1 ? m.slice(idx + 1) : 0;

    if (exp) {
        m = m.slice(0, idx).replace('.', '');
        m += arrJoin.call(Array(exp - (m.length - 1) + 1), '0')
          + '.' + arrJoin.call(Array(maxFraction + 1), '0');

        igr = m.length;
    }

    // 7. Repeat while cut > 0 and the last character of m is "0":
    while (cut > 0 && m.slice(-1) === "0") {
        // a. Remove the last character from m.
        m = m.slice(0, -1);

        // b. Decrease cut by 1.
        cut--;
    }

    // 8. If the last character of m is ".", then
    if (m.slice(-1) === ".")
        // a. Remove the last character from m.
        m = m.slice(0, -1);

    // 9. If int < minInteger, then
    if (igr < minInteger)
        // a. Let z be the String consisting of minInteger–int occurrences of the
        //    character "0".
        var z = arrJoin.call(Array(minInteger - igr + 1), '0');

    // 10. Let m be the concatenation of Strings z and m.
    // 11. Return m.
    return (z ? z : '') + m;
}

// Sect 11.3.2 Table 2, Numbering systems
// ======================================
var numSys = {
    arab:    [ '\u0660', '\u0661', '\u0662', '\u0663', '\u0664', '\u0665', '\u0666', '\u0667', '\u0668', '\u0669' ],
    arabext: [ '\u06F0', '\u06F1', '\u06F2', '\u06F3', '\u06F4', '\u06F5', '\u06F6', '\u06F7', '\u06F8', '\u06F9' ],
    bali:    [ '\u1B50', '\u1B51', '\u1B52', '\u1B53', '\u1B54', '\u1B55', '\u1B56', '\u1B57', '\u1B58', '\u1B59' ],
    beng:    [ '\u09E6', '\u09E7', '\u09E8', '\u09E9', '\u09EA', '\u09EB', '\u09EC', '\u09ED', '\u09EE', '\u09EF' ],
    deva:    [ '\u0966', '\u0967', '\u0968', '\u0969', '\u096A', '\u096B', '\u096C', '\u096D', '\u096E', '\u096F' ],
    fullwide:[ '\uFF10', '\uFF11', '\uFF12', '\uFF13', '\uFF14', '\uFF15', '\uFF16', '\uFF17', '\uFF18', '\uFF19' ],
    gujr:    [ '\u0AE6', '\u0AE7', '\u0AE8', '\u0AE9', '\u0AEA', '\u0AEB', '\u0AEC', '\u0AED', '\u0AEE', '\u0AEF' ],
    guru:    [ '\u0A66', '\u0A67', '\u0A68', '\u0A69', '\u0A6A', '\u0A6B', '\u0A6C', '\u0A6D', '\u0A6E', '\u0A6F' ],
    hanidec: [ '\u3007', '\u4E00', '\u4E8C', '\u4E09', '\u56DB', '\u4E94', '\u516D', '\u4E03', '\u516B', '\u4E5D' ],
    khmr:    [ '\u17E0', '\u17E1', '\u17E2', '\u17E3', '\u17E4', '\u17E5', '\u17E6', '\u17E7', '\u17E8', '\u17E9' ],
    knda:    [ '\u0CE6', '\u0CE7', '\u0CE8', '\u0CE9', '\u0CEA', '\u0CEB', '\u0CEC', '\u0CED', '\u0CEE', '\u0CEF' ],
    laoo:    [ '\u0ED0', '\u0ED1', '\u0ED2', '\u0ED3', '\u0ED4', '\u0ED5', '\u0ED6', '\u0ED7', '\u0ED8', '\u0ED9' ],
    latn:    [ '\u0030', '\u0031', '\u0032', '\u0033', '\u0034', '\u0035', '\u0036', '\u0037', '\u0038', '\u0039' ],
    limb:    [ '\u1946', '\u1947', '\u1948', '\u1949', '\u194A', '\u194B', '\u194C', '\u194D', '\u194E', '\u194F' ],
    mlym:    [ '\u0D66', '\u0D67', '\u0D68', '\u0D69', '\u0D6A', '\u0D6B', '\u0D6C', '\u0D6D', '\u0D6E', '\u0D6F' ],
    mong:    [ '\u1810', '\u1811', '\u1812', '\u1813', '\u1814', '\u1815', '\u1816', '\u1817', '\u1818', '\u1819' ],
    mymr:    [ '\u1040', '\u1041', '\u1042', '\u1043', '\u1044', '\u1045', '\u1046', '\u1047', '\u1048', '\u1049' ],
    orya:    [ '\u0B66', '\u0B67', '\u0B68', '\u0B69', '\u0B6A', '\u0B6B', '\u0B6C', '\u0B6D', '\u0B6E', '\u0B6F' ],
    tamldec: [ '\u0BE6', '\u0BE7', '\u0BE8', '\u0BE9', '\u0BEA', '\u0BEB', '\u0BEC', '\u0BED', '\u0BEE', '\u0BEF' ],
    telu:    [ '\u0C66', '\u0C67', '\u0C68', '\u0C69', '\u0C6A', '\u0C6B', '\u0C6C', '\u0C6D', '\u0C6E', '\u0C6F' ],
    thai:    [ '\u0E50', '\u0E51', '\u0E52', '\u0E53', '\u0E54', '\u0E55', '\u0E56', '\u0E57', '\u0E58', '\u0E59' ],
    tibt:    [ '\u0F20', '\u0F21', '\u0F22', '\u0F23', '\u0F24', '\u0F25', '\u0F26', '\u0F27', '\u0F28', '\u0F29' ]
};

/**
 * This function provides access to the locale and formatting options computed
 * during initialization of the object.
 *
 * The function returns a new object whose properties and attributes are set as
 * if constructed by an object literal assigning to each of the following
 * properties the value of the corresponding internal property of this
 * NumberFormat object (see 11.4): locale, numberingSystem, style, currency,
 * currencyDisplay, minimumIntegerDigits, minimumFractionDigits,
 * maximumFractionDigits, minimumSignificantDigits, maximumSignificantDigits, and
 * useGrouping. Properties whose corresponding internal properties are not present
 * are not assigned.
 */
/* 11.3.3 */defineProperty(Intl.NumberFormat.prototype, 'resolvedOptions', {
    configurable: true,
    writable: true,
    value: function () {
        var prop,
            descs = new Record(),
            props = [
                'locale', 'numberingSystem', 'style', 'currency', 'currencyDisplay',
                'minimumIntegerDigits', 'minimumFractionDigits', 'maximumFractionDigits',
                'minimumSignificantDigits', 'maximumSignificantDigits', 'useGrouping'
            ],
            internal = this != null && typeof this === 'object' && getInternalProperties(this);

        // Satisfy test 11.3_b
        if (!internal || !internal['[[initializedNumberFormat]]'])
            throw new TypeError('`this` value for resolvedOptions() is not an initialized Intl.NumberFormat object.');

        for (var i = 0, max = props.length; i < max; i++) {
            if (hop.call(internal, prop = '[['+ props[i] +']]'))
                descs[props[i]] = { value: internal[prop], writable: true, configurable: true, enumerable: true };
        }

        return objCreate({}, descs);
    }
});

// 12.1 The Intl.DateTimeFormat constructor
// ==================================

// Define the DateTimeFormat constructor internally so it cannot be tainted
function DateTimeFormatConstructor () {
    var locales = arguments[0];
    var options = arguments[1];

    if (!this || this === Intl) {
        return new Intl.DateTimeFormat(locales, options);
    }
    return InitializeDateTimeFormat(toObject(this), locales, options);
}

defineProperty(Intl, 'DateTimeFormat', {
    configurable: true,
    writable: true,
    value: DateTimeFormatConstructor
});

// Must explicitly set prototypes as unwritable
defineProperty(DateTimeFormatConstructor, 'prototype', {
    writable: false
});

/**
 * The abstract operation InitializeDateTimeFormat accepts the arguments dateTimeFormat
 * (which must be an object), locales, and options. It initializes dateTimeFormat as a
 * DateTimeFormat object.
 */
function/* 12.1.1.1 */InitializeDateTimeFormat (dateTimeFormat, locales, options) {
    var
    // This will be a internal properties object if we're not already initialized
        internal = getInternalProperties(dateTimeFormat),

    // Create an object whose props can be used to restore the values of RegExp props
        regexpState = createRegExpRestore();

    // 1. If dateTimeFormat has an [[initializedIntlObject]] internal property with
    //    value true, throw a TypeError exception.
    if (internal['[[initializedIntlObject]]'] === true)
        throw new TypeError('`this` object has already been initialized as an Intl object');

    // Need this to access the `internal` object
    defineProperty(dateTimeFormat, '__getInternalProperties', {
        value: function () {
            // NOTE: Non-standard, for internal use only
            if (arguments[0] === secret)
                return internal;
        }
    });

    // 2. Set the [[initializedIntlObject]] internal property of numberFormat to true.
    internal['[[initializedIntlObject]]'] = true;

    var
    // 3. Let requestedLocales be the result of calling the CanonicalizeLocaleList
    //    abstract operation (defined in 9.2.1) with argument locales.
        requestedLocales = CanonicalizeLocaleList(locales),

    // 4. Let options be the result of calling the ToDateTimeOptions abstract
    //    operation (defined below) with arguments options, "any", and "date".
        options = ToDateTimeOptions(options, 'any', 'date'),

    // 5. Let opt be a new Record.
        opt = new Record();

    // 6. Let matcher be the result of calling the GetOption abstract operation
    //    (defined in 9.2.9) with arguments options, "localeMatcher", "string", a List
    //    containing the two String values "lookup" and "best fit", and "best fit".
        matcher = GetOption(options, 'localeMatcher', 'string', new List('lookup', 'best fit'), 'best fit');

    // 7. Set opt.[[localeMatcher]] to matcher.
    opt['[[localeMatcher]]'] = matcher;

    var
    // 8. Let DateTimeFormat be the standard built-in object that is the initial
    //    value of Intl.DateTimeFormat.
        DateTimeFormat = internals.DateTimeFormat, // This is what we *really* need

    // 9. Let localeData be the value of the [[localeData]] internal property of
    //    DateTimeFormat.
        localeData = DateTimeFormat['[[localeData]]'],

    // 10. Let r be the result of calling the ResolveLocale abstract operation
    //     (defined in 9.2.5) with the [[availableLocales]] internal property of
    //      DateTimeFormat, requestedLocales, opt, the [[relevantExtensionKeys]]
    //      internal property of DateTimeFormat, and localeData.
        r = ResolveLocale(DateTimeFormat['[[availableLocales]]'], requestedLocales,
                opt, DateTimeFormat['[[relevantExtensionKeys]]'], localeData);

    // 11. Set the [[locale]] internal property of dateTimeFormat to the value of
    //     r.[[locale]].
    internal['[[locale]]'] = r['[[locale]]'];

    // 12. Set the [[calendar]] internal property of dateTimeFormat to the value of
    //     r.[[ca]].
    internal['[[calendar]]'] = r['[[ca]]'];

    // 13. Set the [[numberingSystem]] internal property of dateTimeFormat to the value of
    //     r.[[nu]].
    internal['[[numberingSystem]]'] = r['[[nu]]'];

    // The specification doesn't tell us to do this, but it's helpful later on
    internal['[[dataLocale]]'] = r['[[dataLocale]]'];

    var
    // 14. Let dataLocale be the value of r.[[dataLocale]].
        dataLocale = r['[[dataLocale]]'],

    // 15. Let tz be the result of calling the [[Get]] internal method of options with
    //     argument "timeZone".
        tz = options.timeZone;

    // 16. If tz is not undefined, then
    if (tz !== undefined) {
        // a. Let tz be ToString(tz).
        // b. Convert tz to upper case as described in 6.1.
        //    NOTE: If an implementation accepts additional time zone values, as permitted
        //          under certain conditions by the Conformance clause, different casing
        //          rules apply.
        tz = toLatinUpperCase(tz);

        // c. If tz is not "UTC", then throw a RangeError exception.
        // ###TODO: accept more time zones###
        if (tz !== 'UTC')
            throw new RangeError('timeZone is not supported.');
    }

    // 17. Set the [[timeZone]] internal property of dateTimeFormat to tz.
    internal['[[timeZone]]'] = tz;

    // 18. Let opt be a new Record.
    opt = new Record();

    // 19. For each row of Table 3, except the header row, do:
    for (var prop in dateTimeComponents) {
        if (!hop.call(dateTimeComponents, prop))
            continue;

        var
        // 20. Let prop be the name given in the Property column of the row.
        // 21. Let value be the result of calling the GetOption abstract operation,
        //     passing as argument options, the name given in the Property column of the
        //     row, "string", a List containing the strings given in the Values column of
        //     the row, and undefined.
            value = GetOption(options, prop, 'string', dateTimeComponents[prop]);

        // 22. Set opt.[[<prop>]] to value.
        opt['[['+prop+']]'] = value;
    }

    var
        // Assigned a value below
        bestFormat,

        // 23. Let dataLocaleData be the result of calling the [[Get]] internal method of
        //     localeData with argument dataLocale.
        dataLocaleData = localeData[dataLocale],

        // 24. Let formats be the result of calling the [[Get]] internal method of
        //     dataLocaleData with argument "formats".
        formats = dataLocaleData.formats,
        // 25. Let matcher be the result of calling the GetOption abstract operation with
        //     arguments options, "formatMatcher", "string", a List containing the two String
        //     values "basic" and "best fit", and "best fit".
        matcher = GetOption(options, 'formatMatcher', 'string', new List('basic', 'best fit'), 'best fit');

    // 26. If matcher is "basic", then
    if (matcher === 'basic')
        // 27. Let bestFormat be the result of calling the BasicFormatMatcher abstract
        //     operation (defined below) with opt and formats.
        bestFormat = BasicFormatMatcher(opt, formats);

    // 28. Else
    else
        // 29. Let bestFormat be the result of calling the BestFitFormatMatcher
        //     abstract operation (defined below) with opt and formats.
        bestFormat = BestFitFormatMatcher(opt, formats);

    // 30. For each row in Table 3, except the header row, do
    for (var prop in dateTimeComponents) {
        if (!hop.call(dateTimeComponents, prop))
            continue;

        // a. Let prop be the name given in the Property column of the row.
        // b. Let pDesc be the result of calling the [[GetOwnProperty]] internal method of
        //    bestFormat with argument prop.
        // c. If pDesc is not undefined, then
        if (hop.call(bestFormat, prop)) {
            var
            // i. Let p be the result of calling the [[Get]] internal method of bestFormat
            //    with argument prop.
                p = bestFormat[prop];

            // ii. Set the [[<prop>]] internal property of dateTimeFormat to p.
            internal['[['+prop+']]'] = p;
        }
    }

    var
        // Assigned a value below
        pattern,

    // 31. Let hr12 be the result of calling the GetOption abstract operation with
    //     arguments options, "hour12", "boolean", undefined, and undefined.
        hr12 = GetOption(options, 'hour12', 'boolean'/*, undefined, undefined*/);

    // 32. If dateTimeFormat has an internal property [[hour]], then
    if (internal['[[hour]]']) {
        // a. If hr12 is undefined, then let hr12 be the result of calling the [[Get]]
        //    internal method of dataLocaleData with argument "hour12".
        hr12 = hr12 === undefined ? dataLocaleData.hour12 : hr12;

        // b. Set the [[hour12]] internal property of dateTimeFormat to hr12.
        internal['[[hour12]]'] = hr12;

        // c. If hr12 is true, then
        if (hr12 === true) {
            var
            // i. Let hourNo0 be the result of calling the [[Get]] internal method of
            //    dataLocaleData with argument "hourNo0".
                hourNo0 = dataLocaleData.hourNo0;

            // ii. Set the [[hourNo0]] internal property of dateTimeFormat to hourNo0.
            internal['[[hourNo0]]'] = hourNo0;

            // iii. Let pattern be the result of calling the [[Get]] internal method of
            //      bestFormat with argument "pattern12".
            pattern = bestFormat.pattern12;
        }

        // d. Else
        else
            // i. Let pattern be the result of calling the [[Get]] internal method of
            //    bestFormat with argument "pattern".
            pattern = bestFormat.pattern;
    }

    // 33. Else
    else
        // a. Let pattern be the result of calling the [[Get]] internal method of
        //    bestFormat with argument "pattern".
        pattern = bestFormat.pattern;

    // 34. Set the [[pattern]] internal property of dateTimeFormat to pattern.
    internal['[[pattern]]'] = pattern;

    // 35. Set the [[boundFormat]] internal property of dateTimeFormat to undefined.
    internal['[[boundFormat]]'] = undefined;

    // 36. Set the [[initializedDateTimeFormat]] internal property of dateTimeFormat to
    //     true.
    internal['[[initializedDateTimeFormat]]'] = true;

    // In ES3, we need to pre-bind the format() function
    if (es3)
        dateTimeFormat.format = GetFormatDateTime.call(dateTimeFormat);

    // Restore the RegExp properties
    regexpState.exp.test(regexpState.input);

    // Return the newly initialised object
    return dateTimeFormat;
}

/**
 * Several DateTimeFormat algorithms use values from the following table, which provides
 * property names and allowable values for the components of date and time formats:
 */
var dateTimeComponents = {
         weekday: [ "narrow", "short", "long" ],
             era: [ "narrow", "short", "long" ],
            year: [ "2-digit", "numeric" ],
           month: [ "2-digit", "numeric", "narrow", "short", "long" ],
             day: [ "2-digit", "numeric" ],
            hour: [ "2-digit", "numeric" ],
          minute: [ "2-digit", "numeric" ],
          second: [ "2-digit", "numeric" ],
    timeZoneName: [ "short", "long" ]
};

/**
 * When the ToDateTimeOptions abstract operation is called with arguments options,
 * required, and defaults, the following steps are taken:
 */
function ToDateTimeOptions (options, required, defaults) {
    // 1. If options is undefined, then let options be null, else let options be
    //    ToObject(options).
    if (options === undefined)
        options = null;

    else {
        // (#12) options needs to be a Record, but it also needs to inherit properties
        var opt2 = toObject(options);
        options = new Record();

        for (var k in opt2)
            options[k] = opt2[k];
    }

    var
    // 2. Let create be the standard built-in function object defined in ES5, 15.2.3.5.
        create = objCreate,

    // 3. Let options be the result of calling the [[Call]] internal method of create with
    //    undefined as the this value and an argument list containing the single item
    //    options.
        options = create(options),

    // 4. Let needDefaults be true.
        needDefaults = true;

    // 5. If required is "date" or "any", then
    if (required === 'date' || required === 'any') {
        // a. For each of the property names "weekday", "year", "month", "day":
            // i. If the result of calling the [[Get]] internal method of options with the
            //    property name is not undefined, then let needDefaults be false.
        if (options.weekday !== undefined || options.year !== undefined
                || options.month !== undefined || options.day !== undefined)
            needDefaults = false;
    }

    // 6. If required is "time" or "any", then
    if (required === 'time' || required === 'any') {
        // a. For each of the property names "hour", "minute", "second":
            // i. If the result of calling the [[Get]] internal method of options with the
            //    property name is not undefined, then let needDefaults be false.
        if (options.hour !== undefined || options.minute !== undefined || options.second !== undefined)
                needDefaults = false;
    }

    // 7. If needDefaults is true and defaults is either "date" or "all", then
    if (needDefaults && (defaults === 'date' || defaults === 'all'))
        // a. For each of the property names "year", "month", "day":
            // i. Call the [[DefineOwnProperty]] internal method of options with the
            //    property name, Property Descriptor {[[Value]]: "numeric", [[Writable]]:
            //    true, [[Enumerable]]: true, [[Configurable]]: true}, and false.
        options.year = options.month = options.day = 'numeric';

    // 8. If needDefaults is true and defaults is either "time" or "all", then
    if (needDefaults && (defaults === 'time' || defaults === 'all'))
        // a. For each of the property names "hour", "minute", "second":
            // i. Call the [[DefineOwnProperty]] internal method of options with the
            //    property name, Property Descriptor {[[Value]]: "numeric", [[Writable]]:
            //    true, [[Enumerable]]: true, [[Configurable]]: true}, and false.
        options.hour = options.minute = options.second = 'numeric';

    // 9. Return options.
    return options;
}

/**
 * When the BasicFormatMatcher abstract operation is called with two arguments options and
 * formats, the following steps are taken:
 */
function BasicFormatMatcher (options, formats) {
    return calculateScore(options, formats);
}

/**
 * Calculates score for BestFitFormatMatcher and BasicFormatMatcher.
 * Abstracted from BasicFormatMatcher section.
 */
function calculateScore (options, formats, bestFit) {
    var
    // Additional penalty type when bestFit === true
       diffDataTypePenalty = 8,

    // 1. Let removalPenalty be 120.
        removalPenalty = 120,

    // 2. Let additionPenalty be 20.
        additionPenalty = 20,

    // 3. Let longLessPenalty be 8.
        longLessPenalty = 8,

    // 4. Let longMorePenalty be 6.
        longMorePenalty = 6,

    // 5. Let shortLessPenalty be 6.
        shortLessPenalty = 6,

    // 6. Let shortMorePenalty be 3.
        shortMorePenalty = 3,

    // 7. Let bestScore be -Infinity.
        bestScore = -Infinity,

    // 8. Let bestFormat be undefined.
        bestFormat,

    // 9. Let i be 0.
        i = 0,

    // 10. Let len be the result of calling the [[Get]] internal method of formats with argument "length".
        len = formats.length;

    // 11. Repeat while i < len:
    while (i < len) {
        var
        // a. Let format be the result of calling the [[Get]] internal method of formats with argument ToString(i).
            format = formats[i],

        // b. Let score be 0.
            score = 0;

        // c. For each property shown in Table 3:
        for (var property in dateTimeComponents) {
            if (!hop.call(dateTimeComponents, property))
                continue;

            var
            // i. Let optionsProp be options.[[<property>]].
                optionsProp = options['[['+ property +']]'],

            // ii. Let formatPropDesc be the result of calling the [[GetOwnProperty]] internal method of format
            //     with argument property.
            // iii. If formatPropDesc is not undefined, then
            //     1. Let formatProp be the result of calling the [[Get]] internal method of format with argument property.
                formatProp = hop.call(format, property) ? format[property] : undefined;

            // iv. If optionsProp is undefined and formatProp is not undefined, then decrease score by
            //     additionPenalty.
            if (optionsProp === undefined && formatProp !== undefined)
                score -= additionPenalty;

            // v. Else if optionsProp is not undefined and formatProp is undefined, then decrease score by
            //    removalPenalty.
            else if (optionsProp !== undefined && formatProp === undefined)
                score -= removalPenalty;

            // vi. Else
            else {
                var
                // 1. Let values be the array ["2-digit", "numeric", "narrow", "short",
                //    "long"].
                    values = [ '2-digit', 'numeric', 'narrow', 'short', 'long' ],

                // 2. Let optionsPropIndex be the index of optionsProp within values.
                    optionsPropIndex = arrIndexOf.call(values, optionsProp),

                // 3. Let formatPropIndex be the index of formatProp within values.
                    formatPropIndex = arrIndexOf.call(values, formatProp),

                // 4. Let delta be max(min(formatPropIndex - optionsPropIndex, 2), -2).
                    delta = Math.max(Math.min(formatPropIndex - optionsPropIndex, 2), -2);

                // When the bestFit argument is true, subtract additional penalty where data types are not the same
                if (bestFit && (
                    ((optionsProp === 'numeric' || optionsProp === '2-digit') && (formatProp !== 'numeric' && formatProp !== '2-digit'))
                 || ((optionsProp !== 'numeric' && optionsProp !== '2-digit') && (formatProp === '2-digit' || formatProp === 'numeric'))
                ))
                    score -= diffDataTypePenalty;

                // 5. If delta = 2, decrease score by longMorePenalty.
                if (delta === 2)
                    score -= longMorePenalty;

                // 6. Else if delta = 1, decrease score by shortMorePenalty.
                else if (delta === 1)
                    score -= shortMorePenalty;

                // 7. Else if delta = -1, decrease score by shortLessPenalty.
                else if (delta === -1)
                    score -= shortLessPenalty;

                // 8. Else if delta = -2, decrease score by longLessPenalty.
                else if (delta === -2)
                    score -= longLessPenalty;
            }
        }

        // d. If score > bestScore, then
        if (score > bestScore) {
            // i. Let bestScore be score.
            bestScore = score;

            // ii. Let bestFormat be format.
            bestFormat = format;
        }

        // e. Increase i by 1.
        i++;
    }

    // 12. Return bestFormat.
    return bestFormat;
}

/**
 * When the BestFitFormatMatcher abstract operation is called with two arguments options
 * and formats, it performs implementation dependent steps, which should return a set of
 * component representations that a typical user of the selected locale would perceive as
 * at least as good as the one returned by BasicFormatMatcher.
 *
 * This polyfill defines the algorithm to be the same as BasicFormatMatcher,
 * with the addition of bonus points awarded where the requested format is of
 * the same data type as the potentially matching format.
 *
 * For example,
 *
 *     { month: 'numeric', day: 'numeric' }
 *
 * should match
 *
 *     { month: '2-digit', day: '2-digit' }
 *
 * rather than
 *
 *     { month: 'short', day: 'numeric' }
 *
 * This makes sense because a user requesting a formatted date with numeric parts would
 * not expect to see the returned format containing narrow, short or long part names
 */
function BestFitFormatMatcher (options, formats) {
    return calculateScore(options, formats, true);
}

/* 12.2.3 */internals.DateTimeFormat = {
    '[[availableLocales]]': [],
    '[[relevantExtensionKeys]]': ['ca', 'nu'],
    '[[localeData]]': {}
};

/**
 * When the supportedLocalesOf method of Intl.DateTimeFormat is called, the
 * following steps are taken:
 */
/* 12.2.2 */defineProperty(Intl.DateTimeFormat, 'supportedLocalesOf', {
    configurable: true,
    writable: true,
    value: fnBind.call(supportedLocalesOf, internals.DateTimeFormat)
});

/**
 * This named accessor property returns a function that formats a number
 * according to the effective locale and the formatting options of this
 * DateTimeFormat object.
 */
/* 12.3.2 */defineProperty(Intl.DateTimeFormat.prototype, 'format', {
    configurable: true,
    get: GetFormatDateTime
});

function GetFormatDateTime() {
    var internal = this != null && typeof this === 'object' && getInternalProperties(this);

    // Satisfy test 12.3_b
    if (!internal || !internal['[[initializedDateTimeFormat]]'])
        throw new TypeError('`this` value for format() is not an initialized Intl.DateTimeFormat object.');

    // The value of the [[Get]] attribute is a function that takes the following
    // steps:

    // 1. If the [[boundFormat]] internal property of this DateTimeFormat object
    //    is undefined, then:
    if (internal['[[boundFormat]]'] === undefined) {
        var
        // a. Let F be a Function object, with internal properties set as
        //    specified for built-in functions in ES5, 15, or successor, and the
        //    length property set to 0, that takes the argument date and
        //    performs the following steps:
            F = function () {
                //   i. If date is not provided or is undefined, then let x be the
                //      result as if by the expression Date.now() where Date.now is
                //      the standard built-in function defined in ES5, 15.9.4.4.
                //  ii. Else let x be ToNumber(date).
                // iii. Return the result of calling the FormatDateTime abstract
                //      operation (defined below) with arguments this and x.
                var x = Number(arguments.length === 0 ? Date.now() : arguments[0]);
                return FormatDateTime(this, x);
            },
        // b. Let bind be the standard built-in function object defined in ES5,
        //    15.3.4.5.
        // c. Let bf be the result of calling the [[Call]] internal method of
        //    bind with F as the this value and an argument list containing
        //    the single item this.
            bf = fnBind.call(F, this);
        // d. Set the [[boundFormat]] internal property of this NumberFormat
        //    object to bf.
        internal['[[boundFormat]]'] = bf;
    }
    // Return the value of the [[boundFormat]] internal property of this
    // NumberFormat object.
    return internal['[[boundFormat]]'];
}

/**
 * When the FormatDateTime abstract operation is called with arguments dateTimeFormat
 * (which must be an object initialized as a DateTimeFormat) and x (which must be a Number
 * value), it returns a String value representing x (interpreted as a time value as
 * specified in ES5, 15.9.1.1) according to the effective locale and the formatting
 * options of dateTimeFormat.
 */
function FormatDateTime(dateTimeFormat, x) {
    // 1. If x is not a finite Number, then throw a RangeError exception.
    if (!isFinite(x))
        throw new RangeError('Invalid valid date passed to format');

    var
        internal = dateTimeFormat.__getInternalProperties(secret),

    // Creating restore point for properties on the RegExp object... please wait
        regexpState = createRegExpRestore(),

    // 2. Let locale be the value of the [[locale]] internal property of dateTimeFormat.
        locale = internal['[[locale]]'],

    // 3. Let nf be the result of creating a new NumberFormat object as if by the
    // expression new Intl.NumberFormat([locale], {useGrouping: false}) where
    // Intl.NumberFormat is the standard built-in constructor defined in 11.1.3.
        nf = new Intl.NumberFormat([locale], {useGrouping: false}),

    // 4. Let nf2 be the result of creating a new NumberFormat object as if by the
    // expression new Intl.NumberFormat([locale], {minimumIntegerDigits: 2, useGrouping:
    // false}) where Intl.NumberFormat is the standard built-in constructor defined in
    // 11.1.3.
        nf2 = new Intl.NumberFormat([locale], {minimumIntegerDigits: 2, useGrouping: false}),

    // 5. Let tm be the result of calling the ToLocalTime abstract operation (defined
    // below) with x, the value of the [[calendar]] internal property of dateTimeFormat,
    // and the value of the [[timeZone]] internal property of dateTimeFormat.
        tm = ToLocalTime(x, internal['[[calendar]]'], internal['[[timeZone]]']),

    // 6. Let result be the value of the [[pattern]] internal property of dateTimeFormat.
        result = internal['[[pattern]]'],

    // Need the locale minus any extensions
        dataLocale = internal['[[dataLocale]]'],

    // Need the calendar data from CLDR
        localeData = internals.DateTimeFormat['[[localeData]]'][dataLocale].calendars,
        ca = internal['[[calendar]]'];

    // 7. For each row of Table 3, except the header row, do:
    for (var p in dateTimeComponents) {
        // a. If dateTimeFormat has an internal property with the name given in the
        //    Property column of the row, then:
        if (hop.call(internal, '[['+ p +']]')) {
            var
            // Assigned values below
                pm, fv,

            //   i. Let p be the name given in the Property column of the row.
            //  ii. Let f be the value of the [[<p>]] internal property of dateTimeFormat.
                f = internal['[['+ p +']]'],

            // iii. Let v be the value of tm.[[<p>]].
                v = tm['[['+ p +']]'];

            //  iv. If p is "year" and v ≤ 0, then let v be 1 - v.
            if (p === 'year' && v <= 0)
                v = 1 - v;

            //   v. If p is "month", then increase v by 1.
            else if (p === 'month')
                v++;

            //  vi. If p is "hour" and the value of the [[hour12]] internal property of
            //      dateTimeFormat is true, then
            else if (p === 'hour' && internal['[[hour12]]'] === true) {
                // 1. Let v be v modulo 12.
                v = v % 12;

                // 2. If v is equal to the value of tm.[[<p>]], then let pm be false; else
                //    let pm be true.
                pm = v !== tm['[['+ p +']]'];

                // 3. If v is 0 and the value of the [[hourNo0]] internal property of
                //    dateTimeFormat is true, then let v be 12.
                if (v === 0 && internal['[[hourNo0]]'] === true)
                    v = 12;
            }

            // vii. If f is "numeric", then
            if (f === 'numeric')
                // 1. Let fv be the result of calling the FormatNumber abstract operation
                //    (defined in 11.3.2) with arguments nf and v.
                fv = FormatNumber(nf, v);

            // viii. Else if f is "2-digit", then
            else if (f === '2-digit') {
                // 1. Let fv be the result of calling the FormatNumber abstract operation
                //    with arguments nf2 and v.
                fv = FormatNumber(nf2, v);

                // 2. If the length of fv is greater than 2, let fv be the substring of fv
                //    containing the last two characters.
                if (fv.length > 2)
                    fv = fv.slice(-2);
            }

            // ix. Else if f is "narrow", "short", or "long", then let fv be a String
            //     value representing f in the desired form; the String value depends upon
            //     the implementation and the effective locale and calendar of
            //     dateTimeFormat. If p is "month", then the String value may also depend
            //     on whether dateTimeFormat has a [[day]] internal property. If p is
            //     "timeZoneName", then the String value may also depend on the value of
            //     the [[inDST]] field of tm.
            else if (f in dateWidths) {
                switch (p) {
                    case 'month':
                        fv = resolveDateString(localeData, ca, 'months', f, tm['[['+ p +']]']);
                        break;

                    case 'weekday':
                        try {
                            fv = resolveDateString(localeData, ca, 'days', f, tm['[['+ p +']]']);
                            // fv = resolveDateString(ca.days, f)[tm['[['+ p +']]']];
                        } catch (e) {
                            throw new Error('Could not find weekday data for locale '+locale);
                        }
                        break;

                    case 'timeZoneName':
                        fv = ''; // TODO
                        break;

                    // TODO: Era
                    default:
                        fv = tm['[['+ p +']]'];
                }
            }

            // x. Replace the substring of result that consists of "{", p, and "}", with
            //    fv.
            result = result.replace('{'+ p +'}', fv);
        }
    }
    // 8. If dateTimeFormat has an internal property [[hour12]] whose value is true, then
    if (internal['[[hour12]]'] === true) {
        // a. If pm is true, then let fv be an implementation and locale dependent String
        //    value representing “post meridiem”; else let fv be an implementation and
        //    locale dependent String value representing “ante meridiem”.
        fv = resolveDateString(localeData, ca, 'dayPeriods', pm ? 'pm' : 'am');

        // b. Replace the substring of result that consists of "{ampm}", with fv.
        result = result.replace('{ampm}', fv);
    }

    // Restore properties of the RegExp object
    regexpState.exp.test(regexpState.input);

    // 9. Return result.
    return result;
}

/**
 * When the ToLocalTime abstract operation is called with arguments date, calendar, and
 * timeZone, the following steps are taken:
 */
function ToLocalTime(date, calendar, timeZone) {
    // 1. Apply calendrical calculations on date for the given calendar and time zone to
    //    produce weekday, era, year, month, day, hour, minute, second, and inDST values.
    //    The calculations should use best available information about the specified
    //    calendar and time zone. If the calendar is "gregory", then the calculations must
    //    match the algorithms specified in ES5, 15.9.1, except that calculations are not
    //    bound by the restrictions on the use of best available information on time zones
    //    for local time zone adjustment and daylight saving time adjustment imposed by
    //    ES5, 15.9.1.7 and 15.9.1.8.
    // ###TODO###
    var d = new Date(date),
        m = 'get' + (timeZone || '');

    // 2. Return a Record with fields [[weekday]], [[era]], [[year]], [[month]], [[day]],
    //    [[hour]], [[minute]], [[second]], and [[inDST]], each with the corresponding
    //    calculated value.
    return new Record({
        '[[weekday]]': d[m + 'Day'](),
        '[[era]]'    : +(d[m + 'FullYear']() >= 0),
        '[[year]]'   : d[m + 'FullYear'](),
        '[[month]]'  : d[m + 'Month'](),
        '[[day]]'    : d[m + 'Date'](),
        '[[hour]]'   : d[m + 'Hours'](),
        '[[minute]]' : d[m + 'Minutes'](),
        '[[second]]' : d[m + 'Seconds'](),
        '[[inDST]]'  : false // ###TODO###
    });
}

/**
 * The function returns a new object whose properties and attributes are set as if
 * constructed by an object literal assigning to each of the following properties the
 * value of the corresponding internal property of this DateTimeFormat object (see 12.4):
 * locale, calendar, numberingSystem, timeZone, hour12, weekday, era, year, month, day,
 * hour, minute, second, and timeZoneName. Properties whose corresponding internal
 * properties are not present are not assigned.
 */
/* 12.3.3 */defineProperty(Intl.DateTimeFormat.prototype, 'resolvedOptions', {
    writable: true,
    configurable: true,
    value: function () {
        var prop,
            descs = new Record(),
            props = [
                'locale', 'calendar', 'numberingSystem', 'timeZone', 'hour12', 'weekday',
                'era', 'year', 'month', 'day', 'hour', 'minute', 'second', 'timeZoneName'
            ],
            internal = this != null && typeof this === 'object' && getInternalProperties(this);

        // Satisfy test 12.3_b
        if (!internal || !internal['[[initializedDateTimeFormat]]'])
            throw new TypeError('`this` value for resolvedOptions() is not an initialized Intl.DateTimeFormat object.');

        for (var i = 0, max = props.length; i < max; i++) {
            if (hop.call(internal, prop = '[[' + props[i] + ']]'))
                descs[props[i]] = { value: internal[prop], writable: true, configurable: true, enumerable: true };
        }

        return objCreate({}, descs);
    }
});

// Sect 13 Locale Sensitive Functions of the ECMAScript Language Specification
// ===========================================================================

var ls = Intl.__localeSensitiveProtos = {
    Number: {},
    Date:   {}
};

/**
 * When the toLocaleString method is called with optional arguments locales and options,
 * the following steps are taken:
 */
/* 13.2.1 */ls.Number.toLocaleString = function () {
    // Satisfy test 13.2.1_1
    if (Object.prototype.toString.call(this) !== '[object Number]')
        throw new TypeError('`this` value must be a number for Number.prototype.toLocaleString()');

    // 1. Let x be this Number value (as defined in ES5, 15.7.4).
    // 2. If locales is not provided, then let locales be undefined.
    // 3. If options is not provided, then let options be undefined.
    // 4. Let numberFormat be the result of creating a new object as if by the
    //    expression new Intl.NumberFormat(locales, options) where
    //    Intl.NumberFormat is the standard built-in constructor defined in 11.1.3.
    // 5. Return the result of calling the FormatNumber abstract operation
    //    (defined in 11.3.2) with arguments numberFormat and x.
    return FormatNumber(new NumberFormatConstructor(arguments[0], arguments[1]), this);
};

/**
 * When the toLocaleString method is called with optional arguments locales and options,
 * the following steps are taken:
 */
/* 13.3.1 */ls.Date.toLocaleString = function () {
    // Satisfy test 13.3.0_1
    if (Object.prototype.toString.call(this) !== '[object Date]')
        throw new TypeError('`this` value must be a Date instance for Date.prototype.toLocaleString()');

    var
    // 1. Let x be this time value (as defined in ES5, 15.9.5).
        x = +this;

    // 2. If x is NaN, then return "Invalid Date".
    if (isNaN(x))
        return 'Invalid Date';

    var
    // 3. If locales is not provided, then let locales be undefined.
        locales = arguments[0],

    // 4. If options is not provided, then let options be undefined.
        options = arguments[1],

    // 5. Let options be the result of calling the ToDateTimeOptions abstract
    //    operation (defined in 12.1.1) with arguments options, "any", and "all".
        options = ToDateTimeOptions(options, 'any', 'all'),

    // 6. Let dateTimeFormat be the result of creating a new object as if by the
    //    expression new Intl.DateTimeFormat(locales, options) where
    //    Intl.DateTimeFormat is the standard built-in constructor defined in 12.1.3.
        dateTimeFormat = new DateTimeFormatConstructor(locales, options);

    // 7. Return the result of calling the FormatDateTime abstract operation (defined
    //    in 12.3.2) with arguments dateTimeFormat and x.
    return FormatDateTime(dateTimeFormat, x);
};

/**
 * When the toLocaleDateString method is called with optional arguments locales and
 * options, the following steps are taken:
 */
/* 13.3.2 */ls.Date.toLocaleDateString = function () {
    // Satisfy test 13.3.0_1
    if (Object.prototype.toString.call(this) !== '[object Date]')
        throw new TypeError('`this` value must be a Date instance for Date.prototype.toLocaleDateString()');

    var
    // 1. Let x be this time value (as defined in ES5, 15.9.5).
        x = +this;

    // 2. If x is NaN, then return "Invalid Date".
    if (isNaN(x))
        return 'Invalid Date';

    var
    // 3. If locales is not provided, then let locales be undefined.
        locales = arguments[0],

    // 4. If options is not provided, then let options be undefined.
        options = arguments[1],

    // 5. Let options be the result of calling the ToDateTimeOptions abstract
    //    operation (defined in 12.1.1) with arguments options, "date", and "date".
        options = ToDateTimeOptions(options, 'date', 'date'),

    // 6. Let dateTimeFormat be the result of creating a new object as if by the
    //    expression new Intl.DateTimeFormat(locales, options) where
    //    Intl.DateTimeFormat is the standard built-in constructor defined in 12.1.3.
        dateTimeFormat = new DateTimeFormatConstructor(locales, options);

    // 7. Return the result of calling the FormatDateTime abstract operation (defined
    //    in 12.3.2) with arguments dateTimeFormat and x.
    return FormatDateTime(dateTimeFormat, x);
};

/**
 * When the toLocaleTimeString method is called with optional arguments locales and
 * options, the following steps are taken:
 */
/* 13.3.3 */ls.Date.toLocaleTimeString = function () {
    // Satisfy test 13.3.0_1
    if (Object.prototype.toString.call(this) !== '[object Date]')
        throw new TypeError('`this` value must be a Date instance for Date.prototype.toLocaleTimeString()');

    var
    // 1. Let x be this time value (as defined in ES5, 15.9.5).
        x = +this;

    // 2. If x is NaN, then return "Invalid Date".
    if (isNaN(x))
        return 'Invalid Date';

    var
    // 3. If locales is not provided, then let locales be undefined.
        locales = arguments[0],

    // 4. If options is not provided, then let options be undefined.
        options = arguments[1],

    // 5. Let options be the result of calling the ToDateTimeOptions abstract
    //    operation (defined in 12.1.1) with arguments options, "time", and "time".
        options = ToDateTimeOptions(options, 'time', 'time'),

    // 6. Let dateTimeFormat be the result of creating a new object as if by the
    //    expression new Intl.DateTimeFormat(locales, options) where
    //    Intl.DateTimeFormat is the standard built-in constructor defined in 12.1.3.
        dateTimeFormat = new DateTimeFormatConstructor(locales, options);

    // 7. Return the result of calling the FormatDateTime abstract operation (defined
    //    in 12.3.2) with arguments dateTimeFormat and x.
    return FormatDateTime(dateTimeFormat, x);
};

defineProperty(Intl, '__applyLocaleSensitivePrototypes', {
    writable: true,
    configurable: true,
    value: function () {
        defineProperty(Number.prototype, 'toLocaleString', { writable: true, configurable: true, value: ls.Number.toLocaleString });

        for (var k in ls.Date) {
            if (hop.call(ls.Date, k))
                defineProperty(Date.prototype, k, { writable: true, configurable: true, value: ls.Date[k] });
        }
    }
});

/**
 * Can't really ship a single script with data for hundreds of locales, so we provide
 * this __addLocaleData method as a means for the developer to add the data on an
 * as-needed basis
 */
defineProperty(Intl, '__addLocaleData', {
    value: function (data) {
        if (!IsStructurallyValidLanguageTag(data.locale))
            throw new Error("Object passed doesn't identify itself with a valid language tag");

        addLocaleData(data, data.locale);
    }
});

function addLocaleData (data, tag) {
    // Both NumberFormat and DateTimeFormat require number data, so throw if it isn't present
    if (!data.number)
        throw new Error("Object passed doesn't contain locale data for Intl.NumberFormat");

    var locale,
        locales = [ tag ],
        parts   = tag.split('-');

    // Create fallbacks for locale data with scripts, e.g. Latn, Hans, Vaii, etc
    if (parts.length > 2 && parts[1].length == 4)
        arrPush.call(locales, parts[0] + '-' + parts[2]);

    while (locale = arrShift.call(locales)) {
        // Add to NumberFormat internal properties as per 11.2.3
        arrPush.call(internals.NumberFormat['[[availableLocales]]'], locale);
        internals.NumberFormat['[[localeData]]'][locale] = data.number;

        // ...and DateTimeFormat internal properties as per 12.2.3
        if (data.date) {
            data.date.nu = data.number.nu;
            arrPush.call(internals.DateTimeFormat['[[availableLocales]]'], locale);
            internals.DateTimeFormat['[[localeData]]'][locale] = data.date;
        }
    }

    // If this is the first set of locale data added, make it the default
    if (defaultLocale === undefined)
        defaultLocale = tag;

    // 11.3 (the NumberFormat prototype object is an Intl.NumberFormat instance)
    if (!numberFormatProtoInitialised) {
        InitializeNumberFormat(Intl.NumberFormat.prototype);
        numberFormatProtoInitialised = true;
    }

    // 11.3 (the NumberFormat prototype object is an Intl.NumberFormat instance)
    if (data.date && !dateTimeFormatProtoInitialised) {
        InitializeDateTimeFormat(Intl.DateTimeFormat.prototype);
        dateTimeFormatProtoInitialised = true;
    }
}

// Helper functions
// ================

/**
 * A function to deal with the inaccuracy of calculating log10 in pre-ES6
 * JavaScript environments. Math.log(num) / Math.LN10 was responsible for
 * causing issue #62.
 */
function log10Floor (n) {
    // ES6 provides the more accurate Math.log10
    if (typeof Math.log10 === 'function')
        return Math.floor(Math.log10(n));

    var x = Math.round(Math.log(n) * Math.LOG10E);
    return x - (Number('1e' + x) > n);
}

/**
 * A merge of the Intl.{Constructor}.supportedLocalesOf functions
 * To make life easier, the function should be bound to the constructor's internal
 * properties object.
 */
function supportedLocalesOf(locales) {
    /*jshint validthis:true */

    // Bound functions only have the `this` value altered if being used as a constructor,
    // this lets us imitate a native function that has no constructor
    if (!hop.call(this, '[[availableLocales]]'))
        throw new TypeError('supportedLocalesOf() is not a constructor');

    var
    // Create an object whose props can be used to restore the values of RegExp props
        regexpState = createRegExpRestore(),

    // 1. If options is not provided, then let options be undefined.
        options = arguments[1],

    // 2. Let availableLocales be the value of the [[availableLocales]] internal
    //    property of the standard built-in object that is the initial value of
    //    Intl.NumberFormat.

        availableLocales = this['[[availableLocales]]'],

    // 3. Let requestedLocales be the result of calling the CanonicalizeLocaleList
    //    abstract operation (defined in 9.2.1) with argument locales.
        requestedLocales = CanonicalizeLocaleList(locales);

    // Restore the RegExp properties
    regexpState.exp.test(regexpState.input);

    // 4. Return the result of calling the SupportedLocales abstract operation
    //    (defined in 9.2.8) with arguments availableLocales, requestedLocales,
    //    and options.
    return SupportedLocales(availableLocales, requestedLocales, options);
}

/**
 * Returns a string for a date component, resolved using multiple inheritance as specified
 * as specified in the Unicode Technical Standard 35.
 */
function resolveDateString(data, ca, component, width, key) {
    // From http://www.unicode.org/reports/tr35/tr35.html#Multiple_Inheritance:
    // 'In clearly specified instances, resources may inherit from within the same locale.
    //  For example, ... the Buddhist calendar inherits from the Gregorian calendar.'
    var obj = data[ca] && data[ca][component]
                ? data[ca][component]
                : data.gregory[component],

        // "sideways" inheritance resolves strings when a key doesn't exist
        alts = {
            narrow: ['short', 'long'],
            short:  ['long', 'narrow'],
            long:   ['short', 'narrow']
        },

        //
        resolved = hop.call(obj, width)
                  ? obj[width]
                  : hop.call(obj, alts[width][0])
                      ? obj[alts[width][0]]
                      : obj[alts[width][1]];

    // `key` wouldn't be specified for components 'dayPeriods'
    return key != null ? resolved[key] : resolved;
}

/**
 * A map that doesn't contain Object in its prototype chain
 */
Record.prototype = objCreate(null);
function Record (obj) {
    // Copy only own properties over unless this object is already a Record instance
    for (var k in obj) {
        if (obj instanceof Record || hop.call(obj, k))
            defineProperty(this, k, { value: obj[k], enumerable: true, writable: true, configurable: true });
    }
}

/**
 * An ordered list
 */
List.prototype = objCreate(null);
function List() {
    defineProperty(this, 'length', { writable:true, value: 0 });

    if (arguments.length)
        arrPush.apply(this, arrSlice.call(arguments));
}

/**
 * Constructs a regular expression to restore tainted RegExp properties
 */
function createRegExpRestore () {
    var esc = /[.?*+^$[\]\\(){}|-]/g,
        lm  = RegExp.lastMatch,
        ml  = RegExp.multiline ? 'm' : '',
        ret = { input: RegExp.input },
        reg = new List(),
        has = false,
        cap = {};

    // Create a snapshot of all the 'captured' properties
    for (var i = 1; i <= 9; i++)
        has = (cap['$'+i] = RegExp['$'+i]) || has;

    // Now we've snapshotted some properties, escape the lastMatch string
    lm = lm.replace(esc, '\\$&');

    // If any of the captured strings were non-empty, iterate over them all
    if (has) {
        for (var i = 1; i <= 9; i++) {
            var m = cap['$'+i];

            // If it's empty, add an empty capturing group
            if (!m)
                lm = '()' + lm;

            // Else find the string in lm and escape & wrap it to capture it
            else {
                m = m.replace(esc, '\\$&');
                lm = lm.replace(m, '(' + m + ')');
            }

            // Push it to the reg and chop lm to make sure further groups come after
            arrPush.call(reg, lm.slice(0, lm.indexOf('(') + 1));
            lm = lm.slice(lm.indexOf('(') + 1);
        }
    }

    // Create the regular expression that will reconstruct the RegExp properties
    ret.exp = new RegExp(arrJoin.call(reg, '') + lm, ml);

    return ret;
}

/**
 * Convert only a-z to uppercase as per section 6.1 of the spec
 */
function toLatinUpperCase (str) {
    var i = str.length;

    while (i--) {
        var ch = str.charAt(i);

        if (ch >= "a" && ch <= "z")
            str = str.slice(0, i) + ch.toUpperCase() + str.slice(i+1);
    }

    return str;
}

/**
 * Mimics ES5's abstract ToObject() function
 */
function toObject (arg) {
    if (arg == null)
        throw new TypeError('Cannot convert null or undefined to object');

    return Object(arg);
}

/**
 * Returns "internal" properties for an object
 */
function getInternalProperties (obj) {
    if (hop.call(obj, '__getInternalProperties'))
        return obj.__getInternalProperties(secret);
    else
        return objCreate(null);
}

(function () {var a=["gregory","buddhist","chinese","coptic","ethioaa","ethiopic","generic","hebrew","indian","islamic","japanese","persian","roc","long","numeric","2-digit","{weekday} {day}. {month} {year} {hour}.{minute}.{second}","{weekday} {day}. {month} {year} {hour}.{minute}.{second} {ampm}","{weekday} {day}. {month} {year}","{day}. {month} {year}","{day}/{month}/{year}","{month}/{year}","{month} {year}","{day}. {month}","{day}/{month}","{hour}.{minute}.{second}","{hour}.{minute}.{second} {ampm}","{hour}.{minute}","{hour}.{minute} {ampm}","BE","M01","M02","M03","M04","M05","M06","M07","M08","M09","M10","M11","M12","Tout","Baba","Hator","Kiahk","Toba","Amshir","Baramhat","Baramouda","Bashans","Paona","Epep","Mesra","Nasie","ERA0","ERA1","Meskerem","Tekemt","Hedar","Tahsas","Ter","Yekatit","Megabit","Miazia","Genbot","Sene","Hamle","Nehasse","Pagumen","J","F","M","A","S","O","N","D","jan.","feb.","mar.","apr.","maj","jun.","jul.","aug.","sep.","okt.","nov.","dec.","januar","februar","marts","april","juni","juli","august","september","oktober","november","december","sø","ma","ti","on","to","fr","lø","søn.","man.","tir.","ons.","tor.","fre.","lør.","søndag","mandag","tirsdag","onsdag","torsdag","fredag","lørdag","fKr","eKr","fvt","vt","f.Kr.","e.Kr.","f.v.t.","v.t.","før vesterlandsk tidsregning","vesterlandsk tidsregning","AM","PM","Tishri","Heshvan","Kislev","Tevet","Shevat","Adar I","Adar","Nisan","Iyar","Sivan","Tamuz","Av","Elul","Adar II","Chaitra","Vaisakha","Jyaistha","Asadha","Sravana","Bhadra","Asvina","Kartika","Agrahayana","Pausa","Magha","Phalguna","Saka","Muh.","Saf.","Rab. I","Rab. II","Jum. I","Jum. II","Raj.","Sha.","Ram.","Shaw.","Dhuʻl-Q.","Dhuʻl-H.","Muharram","Safar","Rabiʻ I","Rabiʻ II","Jumada I","Jumada II","Rajab","Shaʻban","Ramadan","Shawwal","Dhuʻl-Qiʻdah","Dhuʻl-Hijjah","AH","Taika (645-650)","Hakuchi (650-671)","Hakuhō (672-686)","Shuchō (686-701)","Taihō (701-704)","Keiun (704-708)","Wadō (708-715)","Reiki (715-717)","Yōrō (717-724)","Jinki (724-729)","Tempyō (729-749)","Tempyō-kampō (749-749)","Tempyō-shōhō (749-757)","Tempyō-hōji (757-765)","Temphō-jingo (765-767)","Jingo-keiun (767-770)","Hōki (770-780)","Ten-ō (781-782)","Enryaku (782-806)","Daidō (806-810)","Kōnin (810-824)","Tenchō (824-834)","Jōwa (834-848)","Kajō (848-851)","Ninju (851-854)","Saiko (854-857)","Tennan (857-859)","Jōgan (859-877)","Genkei (877-885)","Ninna (885-889)","Kampyō (889-898)","Shōtai (898-901)","Engi (901-923)","Enchō (923-931)","Shōhei (931-938)","Tengyō (938-947)","Tenryaku (947-957)","Tentoku (957-961)","Ōwa (961-964)","Kōhō (964-968)","Anna (968-970)","Tenroku (970-973)","Ten-en (973-976)","Jōgen (976-978)","Tengen (978-983)","Eikan (983-985)","Kanna (985-987)","Ei-en (987-989)","Eiso (989-990)","Shōryaku (990-995)","Chōtoku (995-999)","Chōhō (999-1004)","Kankō (1004-1012)","Chōwa (1012-1017)","Kannin (1017-1021)","Jian (1021-1024)","Manju (1024-1028)","Chōgen (1028-1037)","Chōryaku (1037-1040)","Chōkyū (1040-1044)","Kantoku (1044-1046)","Eishō (1046-1053)","Tengi (1053-1058)","Kōhei (1058-1065)","Jiryaku (1065-1069)","Enkyū (1069-1074)","Shōho (1074-1077)","Shōryaku (1077-1081)","Eiho (1081-1084)","Ōtoku (1084-1087)","Kanji (1087-1094)","Kaho (1094-1096)","Eichō (1096-1097)","Shōtoku (1097-1099)","Kōwa (1099-1104)","Chōji (1104-1106)","Kashō (1106-1108)","Tennin (1108-1110)","Ten-ei (1110-1113)","Eikyū (1113-1118)","Gen-ei (1118-1120)","Hoan (1120-1124)","Tenji (1124-1126)","Daiji (1126-1131)","Tenshō (1131-1132)","Chōshō (1132-1135)","Hoen (1135-1141)","Eiji (1141-1142)","Kōji (1142-1144)","Tenyō (1144-1145)","Kyūan (1145-1151)","Ninpei (1151-1154)","Kyūju (1154-1156)","Hogen (1156-1159)","Heiji (1159-1160)","Eiryaku (1160-1161)","Ōho (1161-1163)","Chōkan (1163-1165)","Eiman (1165-1166)","Nin-an (1166-1169)","Kaō (1169-1171)","Shōan (1171-1175)","Angen (1175-1177)","Jishō (1177-1181)","Yōwa (1181-1182)","Juei (1182-1184)","Genryuku (1184-1185)","Bunji (1185-1190)","Kenkyū (1190-1199)","Shōji (1199-1201)","Kennin (1201-1204)","Genkyū (1204-1206)","Ken-ei (1206-1207)","Shōgen (1207-1211)","Kenryaku (1211-1213)","Kenpō (1213-1219)","Shōkyū (1219-1222)","Jōō (1222-1224)","Gennin (1224-1225)","Karoku (1225-1227)","Antei (1227-1229)","Kanki (1229-1232)","Jōei (1232-1233)","Tempuku (1233-1234)","Bunryaku (1234-1235)","Katei (1235-1238)","Ryakunin (1238-1239)","En-ō (1239-1240)","Ninji (1240-1243)","Kangen (1243-1247)","Hōji (1247-1249)","Kenchō (1249-1256)","Kōgen (1256-1257)","Shōka (1257-1259)","Shōgen (1259-1260)","Bun-ō (1260-1261)","Kōchō (1261-1264)","Bun-ei (1264-1275)","Kenji (1275-1278)","Kōan (1278-1288)","Shōō (1288-1293)","Einin (1293-1299)","Shōan (1299-1302)","Kengen (1302-1303)","Kagen (1303-1306)","Tokuji (1306-1308)","Enkei (1308-1311)","Ōchō (1311-1312)","Shōwa (1312-1317)","Bunpō (1317-1319)","Genō (1319-1321)","Genkyō (1321-1324)","Shōchū (1324-1326)","Kareki (1326-1329)","Gentoku (1329-1331)","Genkō (1331-1334)","Kemmu (1334-1336)","Engen (1336-1340)","Kōkoku (1340-1346)","Shōhei (1346-1370)","Kentoku (1370-1372)","Bunchũ (1372-1375)","Tenju (1375-1379)","Kōryaku (1379-1381)","Kōwa (1381-1384)","Genchũ (1384-1392)","Meitoku (1384-1387)","Kakei (1387-1389)","Kōō (1389-1390)","Meitoku (1390-1394)","Ōei (1394-1428)","Shōchō (1428-1429)","Eikyō (1429-1441)","Kakitsu (1441-1444)","Bun-an (1444-1449)","Hōtoku (1449-1452)","Kyōtoku (1452-1455)","Kōshō (1455-1457)","Chōroku (1457-1460)","Kanshō (1460-1466)","Bunshō (1466-1467)","Ōnin (1467-1469)","Bunmei (1469-1487)","Chōkyō (1487-1489)","Entoku (1489-1492)","Meiō (1492-1501)","Bunki (1501-1504)","Eishō (1504-1521)","Taiei (1521-1528)","Kyōroku (1528-1532)","Tenmon (1532-1555)","Kōji (1555-1558)","Eiroku (1558-1570)","Genki (1570-1573)","Tenshō (1573-1592)","Bunroku (1592-1596)","Keichō (1596-1615)","Genwa (1615-1624)","Kan-ei (1624-1644)","Shōho (1644-1648)","Keian (1648-1652)","Shōō (1652-1655)","Meiryaku (1655-1658)","Manji (1658-1661)","Kanbun (1661-1673)","Enpō (1673-1681)","Tenwa (1681-1684)","Jōkyō (1684-1688)","Genroku (1688-1704)","Hōei (1704-1711)","Shōtoku (1711-1716)","Kyōhō (1716-1736)","Genbun (1736-1741)","Kanpō (1741-1744)","Enkyō (1744-1748)","Kan-en (1748-1751)","Hōryaku (1751-1764)","Meiwa (1764-1772)","An-ei (1772-1781)","Tenmei (1781-1789)","Kansei (1789-1801)","Kyōwa (1801-1804)","Bunka (1804-1818)","Bunsei (1818-1830)","Tenpō (1830-1844)","Kōka (1844-1848)","Kaei (1848-1854)","Ansei (1854-1860)","Man-en (1860-1861)","Bunkyū (1861-1864)","Genji (1864-1865)","Keiō (1865-1868)","T","H","Bunchū (1372-1375)","Genchū (1384-1392)","Meiji","Taishō","Shōwa","Heisei","Farvardin","Ordibehesht","Khordad","Tir","Mordad","Shahrivar","Mehr","Aban","Azar","Dey","Bahman","Esfand","AP","Before R.O.C.","Minguo","latn","{number}","-{number}","{number} {currency}","-{number} {currency}","{number} %","-{number} %",",",".","NaN","%","∞","AU$","R$","CA$","CN¥","kr","€","£","HK$","₪","₹","JP¥","₩","MX$","NZ$","฿","NT$","$","₫","FCFA","EC$","CFA","CFPF","{weekday}, {day}. {month} {year} {hour}:{minute}:{second}","{weekday}, {day}. {month} {year} {hour}:{minute}:{second} {ampm}","{weekday}, {day}. {month} {year}","{day}.{month}.{year}","{month}.{year}","{day}.{month}","{hour}:{minute}:{second}","{hour}:{minute}:{second} {ampm}","{hour}:{minute}","{hour}:{minute} {ampm}","Jan.","Feb.","März","Apr.","Mai","Juni","Juli","Aug.","Sep.","Okt.","Nov.","Dez.","Januar","Februar","April","August","September","Oktober","November","Dezember","So.","Mo.","Di.","Mi.","Do.","Fr.","Sa.","Sonntag","Montag","Dienstag","Mittwoch","Donnerstag","Freitag","Samstag","v. Chr.","n. Chr.","vdZ","dZ","v. u. Z.","u. Z.","vor der gewöhnlichen Zeitrechnung","der gewöhnlichen Zeitrechnung","vorm.","nachm.","{currency} {number}","{currency}-{number}","'","öS","¥","{weekday}, {month} {day}, {year}, {hour}:{minute}:{second}","{weekday}, {month} {day}, {year}, {hour}:{minute}:{second} {ampm}","{weekday}, {month} {day}, {year}","{month} {day}, {year}","{month} {day}","{month}/{day}","Mo1","Mo2","Mo3","Mo4","Mo5","Mo6","Mo7","Mo8","Mo9","Mo10","Mo11","Mo12","Month1","Month2","Month3","Month4","Month5","Month6","Month7","Month8","Month9","Month10","Month11","Month12","Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec","January","February","March","June","July","October","December","Su","Mo","Tu","We","Th","Fr","Sa","Sun","Mon","Tue","Wed","Thu","Fri","Sat","Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","B","BC","AD","BCE","CE","Before Christ","Anno Domini","Before Common Era","Common Era","{currency}{number}","-{currency}{number}","{number}%","-{number}%","US$","{year}-{month}-{day}","{year}-{month}","{month}-{day}","A$","{weekday}, {day} {month} {year} {hour}:{minute}:{second}","{weekday}, {day} {month} {year} {hour}:{minute}:{second} {ampm}","{weekday}, {day} {month} {year}","{day} {month} {year}","{day} {month}","1","2","3","4","5","6","7","8","9","10","11","12","am","pm","SAKA","{weekday}, {day} {month}, {year}, {hour}:{minute}:{second}","{weekday}, {day} {month}, {year}, {hour}:{minute}:{second} {ampm}","{weekday}, {day} {month}, {year}","{day} {month}, {year}","Bunchū","Genchū","{weekday} {day} {month} {year}, {hour}:{minute}:{second}","{weekday} {day} {month} {year}, {hour}:{minute}:{second} {ampm}","{weekday} {day} {month} {year}","a.m.","p.m.","{weekday} {day} {month}, {year}, {hour}:{minute}:{second}","{weekday} {day} {month}, {year}, {hour}:{minute}:{second} {ampm}","{weekday} {day} {month}, {year}","-{currency} {number}","{month}/{day}/{year}","{weekday}, {day} {month} {year}, {hour}:{minute}:{second}","{weekday}, {day} {month} {year}, {hour}:{minute}:{second} {ampm}","{year}/{month}/{day}"," ","R","{weekday}, {day} de {month} de {year} {hour}:{minute}:{second}","{weekday}, {day} de {month} de {year} {hour}:{minute}:{second} {ampm}","{weekday}, {day} de {month} de {year}","{day} de {month} de {year}","{month}-{year}","{month} de {year}","{day} de {month}","E","ene.","abr.","may.","ago.","sept.","oct.","dic.","enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre","DO","LU","MA","MI","JU","VI","SA","dom.","lun.","mié.","jue.","vie.","sáb.","domingo","lunes","martes","miércoles","jueves","viernes","sábado","a. C.","d. C.","a. e. c.","e. c.","antes de Cristo","anno Dómini","a. m.","p. m.","antes de R.O.C.","R.O.C.","{currency} {number}","-{currency} {number}","₧","{day}-{month}-{year}","{day}-{month}","AR$","Ma","My","Jn","Jl","Ag","febr.","mzo.","my.","ag.","set.","do.","lu.","ma.","mi.","ju.","vi.","sá.","miér.","vier.","sáb","a.C.","d.C.","Naf","Kz","Afl.","ZMK","Bs","dangi","{weekday} {day} {month} {year} {hour}:{minute}:{second}","{weekday} {day} {month} {year} {hour}:{minute}:{second} {ampm}","E.B.","ère b.","ère bouddhiste","1yuè","2yuè","3yuè","4yuè","5yuè","6yuè","7yuè","8yuè","9yuè","10yuè","11yuè","12yuè","zhēngyuè","èryuè","sānyuè","sìyuè","wǔyuè","liùyuè","qīyuè","bāyuè","jiǔyuè","shíyuè","shíyīyuè","shí’èryuè","K","tout","bâb.","hât.","kya.","toub.","amsh.","barma.","barmo.","bash.","ba’o.","abî.","mis.","al-n.","bâbâ","hâtour","kyakh","toubah","amshîr","barmahât","barmoudah","bashans","ba’ounah","abîb","misra","al-nasi","av. D.","ap. D.","avant Dioclétien","après Dioclétien","mäs.","teq.","hed.","tah.","ter","yäk.","mäg.","miy.","gue.","sän.","ham.","näh.","pag.","mäskäräm","teqemt","hedar","tahesas","yäkatit","mägabit","miyazya","guenbot","säné","hamlé","nähasé","pagumén","av. Inc.","ap. Inc.","avant l’Incarnation","après l’Incarnation","janv.","févr.","mars","avr.","mai","juin","juil.","août","déc.","janvier","février","avril","juillet","septembre","octobre","novembre","décembre","di","lu","me","je","ve","sa","dim.","mer.","jeu.","ven.","sam.","dimanche","lundi","mardi","mercredi","jeudi","vendredi","samedi","av. J.-C.","ap. J.-C.","AEC","EC","avant Jésus-Christ","après Jésus-Christ","I","tis.","hes.","kis.","téb.","sché.","ad.I","adar","nis.","iyar","siv.","tam.","ab","ell.","ad.II","Tisseri","Hesvan","Tébeth","Schébat","Nissan","Tamouz","Ab","Elloul","Anno Mundi","C","V","Ā","P","chai.","vai.","jyai.","āsha.","shrā.","bhā.","āshw.","kār.","mār.","pau.","māgh","phāl.","chaitra","vaishākh","jyaishtha","āshādha","shrāvana","bhādrapad","āshwin","kārtik","mārgashīrsha","paush","phālgun","mouh.","saf.","rab. aw.","rab. th.","joum. oul.","joum. tha.","raj.","chaa.","ram.","chaw.","dhou. q.","dhou. h.","mouharram","safar","rabia al awal","rabia ath-thani","joumada al oula","joumada ath-thania","rajab","chaabane","ramadan","chawwal","dhou al qi`da","dhou al-hijja","avant RdC","RdC","$AR","$AU","FB","$BM","$BN","$BS","$BZ","$CA","$CL","¥CN","$CO","$CV","£CY","£EG","$FJ","£FK","£GB","£GI","$HK","£IE","£IL","₤IT","¥JP","£LB","$LR","£MT","$MX","$NA","$NZ","$RH","$SB","£SD","$SG","£SH","$SR","£SS","$TT","$TW","$US","$UY","WS$","FCFP","EB","G","L","gen","feb","mar","apr","mag","giu","lug","ago","set","ott","nov","dic","gennaio","febbraio","aprile","maggio","giugno","luglio","settembre","ottobre","dicembre","dom","lun","mer","gio","ven","sab","domenica","lunedì","martedì","mercoledì","giovedì","venerdì","sabato","aC","dC","Prima della R.O.C.","{year}年{month}月{day}日({weekday}) {hour}:{minute}:{second}","{year}年{month}月{day}日({weekday}) {ampm}{hour}:{minute}:{second}","{year}年{month}月{day}日({weekday}","{year}年{month}月{day}","{year}/{month}","{year}年{month}","{month}月{day}","{ampm}{hour}:{minute}:{second}","{ampm}{hour}:{minute}","仏暦","正","二","三","四","五","六","七","八","九","十","十一","十二","正月","二月","三月","四月","五月","六月","七月","八月","九月","十月","十一月","十二月","13","トウト","ババ","ハトール","キアック","トーバ","アムシール","バラムハート","バラモウダ","バシャンス","パオーナ","エペープ","メスラ","ナシエ","メスケレム","テケムト","ヘダル","ターサス","テル","イェカティト","メガビト","ミアジア","ゲンボト","セネ","ハムレ","ネハッセ","パグメン","1月","2月","3月","4月","5月","6月","7月","8月","9月","10月","11月","12月","日","月","火","水","木","金","土","日曜日","月曜日","火曜日","水曜日","木曜日","金曜日","土曜日","紀元前","西暦","西暦紀元前","午前","午後","ティスレ","へシボン","キスレブ","テベット","シバット","アダル I","アダル","ニサン","イヤル","シバン","タムズ","アヴ","エルル","アダル II","カイトラ","ヴァイサカ","ジャイスタ","アーサダ","スラバナ","バードラ","アスビナ","カルディカ","アヴラハヤナ","パウサ","マーガ","パルグナ","サカ","ムハッラム","サフアル","ラビー・ウル・アウワル","ラビー・ウッ・サーニー","ジュマーダル・アウワル","ジュマーダッサーニー","ラジャブ","シャアバーン","ラマダーン","シャウワール","ズル・カイダ","ズル・ヒッジャ","大化","白雉","白鳯","朱鳥","大宝","慶雲","和銅","霊亀","養老","神亀","天平","天平感宝","天平勝宝","天平宝字","天平神護","神護景雲","宝亀","天応","延暦","大同","弘仁","天長","承和","嘉祥","仁寿","斉衡","天安","貞観","元慶","仁和","寛平","昌泰","延喜","延長","承平","天慶","天暦","天徳","応和","康保","安和","天禄","天延","貞元","天元","永観","寛和","永延","永祚","正暦","長徳","長保","寛弘","長和","寛仁","治安","万寿","長元","長暦","長久","寛徳","永承","天喜","康平","治暦","延久","承保","承暦","永保","応徳","寛治","嘉保","永長","承徳","康和","長治","嘉承","天仁","天永","永久","元永","保安","天治","大治","天承","長承","保延","永治","康治","天養","久安","仁平","久寿","保元","平治","永暦","応保","長寛","永万","仁安","嘉応","承安","安元","治承","養和","寿永","元暦","文治","建久","正治","建仁","元久","建永","承元","建暦","建保","承久","貞応","元仁","嘉禄","安貞","寛喜","貞永","天福","文暦","嘉禎","暦仁","延応","仁治","寛元","宝治","建長","康元","正嘉","正元","文応","弘長","文永","建治","弘安","正応","永仁","正安","乾元","嘉元","徳治","延慶","応長","正和","文保","元応","元亨","正中","嘉暦","元徳","元弘","建武","延元","興国","正平","建徳","文中","天授","康暦","弘和","元中","至徳","嘉慶","康応","明徳","応永","正長","永享","嘉吉","文安","宝徳","享徳","康正","長禄","寛正","文正","応仁","文明","長享","延徳","明応","文亀","永正","大永","享禄","天文","弘治","永禄","元亀","天正","文禄","慶長","元和","寛永","正保","慶安","承応","明暦","万治","寛文","延宝","天和","貞享","元禄","宝永","正徳","享保","元文","寛保","延享","寛延","宝暦","明和","安永","天明","寛政","享和","文化","文政","天保","弘化","嘉永","安政","万延","文久","元治","慶応","明治","大正","昭和","平成","ファルヴァルディーン","オルディーベヘシュト","ホルダード","ティール","モルダード","シャハリーヴァル","メフル","アーバーン","アーザル","デイ","バフマン","エスファンド","民国前","民国","元","￥","￦","{year}년 {month} {day}일 ({weekday})  {hour}:{minute}:{second}","{year}년 {month} {day}일 ({weekday}) {ampm} {hour}:{minute}:{second}","{year}년 {month} {day}일 ({weekday}","{year}년 {month} {day}","{year}. {month}. {day}","{year}. {month}","{year}년 {month}","{month}. {day}","{ampm} {hour}:{minute}:{second}","{ampm} {hour}:{minute}","불기","투트","바바흐","하투르","키야흐크","투바흐","암쉬르","바라마트","바라문다흐","바샨스","바우나흐","아비브","미스라","나시","1월","2월","3월","4월","5월","6월","7월","8월","9월","10월","11월","12월","매스캐램","테켐트","헤다르","타흐사스","테르","얘카티트","매가비트","미야지야","겐보트","새네","함레","내하세","파구맨","일","월","화","수","목","금","토","일요일","월요일","화요일","수요일","목요일","금요일","토요일","기원전","서기","서력기원전","서력기원","오전","오후","디스리월","말케스월","기슬르월","데벳월","스밧월","아달월 1","아달월","닛산월","이야르월","시완월","담무르월","압월","엘룰월","아달월 2","다이카 (645 ~ 650)","하쿠치 (650 ~ 671)","하쿠호 (672 ~ 686)","슈초 (686 ~ 701)","다이호 (701 ~ 704)","게이운 (704 ~ 708)","와도 (708 ~ 715)","레이키 (715 ~ 717)","요로 (717 ~ 724)","진키 (724 ~ 729)","덴표 (729 ~ 749)","덴표칸포 (749 ~ 749)","덴표쇼호 (749 ~ 757)","덴표호지 (757 ~ 765)","덴표진고 (765 ~ 767)","진고케이운 (767 ~ 770)","호키 (770 ~ 780)","덴오 (781 ~ 782)","엔랴쿠 (782 ~ 806)","다이도 (806 ~ 810)","고닌 (810 ~ 824)","덴초 (824 ~ 834)","조와 (834 ~ 848)","가쇼 (848 ~ 851)","닌주 (851 ~ 854)","사이코 (854 ~ 857)","덴난 (857 ~ 859)","조간 (859 ~ 877)","간교 (877 ~ 885)","닌나 (885 ~ 889)","간표 (889 ~ 898)","쇼타이 (898 ~ 901)","엔기 (901 ~ 923)","엔초 (923 ~ 931)","조헤이 (931 ~ 938)","덴교 (938 ~ 947)","덴랴쿠 (947 ~ 957)","덴토쿠 (957 ~ 961)","오와 (961 ~ 964)","고호 (964 ~ 968)","안나 (968 ~ 970)","덴로쿠 (970 ~ 973)","덴엔 (973 ~ 976)","조겐 (976 ~ 978)","덴겐 (978 ~ 983)","에이간 (983 ~ 985)","간나 (985 ~ 987)","에이엔 (987 ~ 989)","에이소 (989 ~ 990)","쇼랴쿠 (990 ~ 995)","조토쿠 (995 ~ 999)","조호 (999 ~ 1004)","간코 (1004 ~ 1012)","조와 (1012 ~ 1017)","간닌 (1017 ~ 1021)","지안 (1021 ~ 1024)","만주 (1024 ~ 1028)","조겐 (1028 ~ 1037)","조랴쿠 (1037 ~ 1040)","조큐 (1040 ~ 1044)","간토쿠 (1044 ~ 1046)","에이쇼 (1046 ~ 1053)","덴기 (1053 ~ 1058)","고헤이 (1058 ~ 1065)","지랴쿠 (1065 ~ 1069)","엔큐 (1069 ~ 1074)","조호 (1074 ~ 1077)","쇼랴쿠 (1077 ~ 1081)","에이호 (1081 ~ 1084)","오토쿠 (1084 ~ 1087)","간지 (1087 ~ 1094)","가호 (1094 ~ 1096)","에이초 (1096 ~ 1097)","조토쿠 (1097 ~ 1099)","고와 (1099 ~ 1104)","조지 (1104 ~ 1106)","가쇼 (1106 ~ 1108)","덴닌 (1108 ~ 1110)","덴에이 (1110 ~ 1113)","에이큐 (1113 ~ 1118)","겐에이 (1118 ~ 1120)","호안 (1120 ~ 1124)","덴지 (1124 ~ 1126)","다이지 (1126 ~ 1131)","덴쇼 (1131 ~ 1132)","조쇼 (1132 ~ 1135)","호엔 (1135 ~ 1141)","에이지 (1141 ~ 1142)","고지 (1142 ~ 1144)","덴요 (1144 ~ 1145)","규안 (1145 ~ 1151)","닌페이 (1151 ~ 1154)","규주 (1154 ~ 1156)","호겐 (1156 ~ 1159)","헤이지 (1159 ~ 1160)","에이랴쿠 (1160 ~ 1161)","오호 (1161 ~ 1163)","조칸 (1163 ~ 1165)","에이만 (1165 ~ 1166)","닌난 (1166 ~ 1169)","가오 (1169 ~ 1171)","조안 (1171 ~ 1175)","안겐 (1175 ~ 1177)","지쇼 (1177 ~ 1181)","요와 (1181 ~ 1182)","주에이 (1182 ~ 1184)","겐랴쿠 (1184 ~ 1185)","분지 (1185 ~ 1190)","겐큐 (1190 ~ 1199)","쇼지 (1199 ~ 1201)","겐닌 (1201 ~ 1204)","겐큐 (1204 ~ 1206)","겐에이 (1206 ~ 1207)","조겐 (1207 ~ 1211)","겐랴쿠 (1211 ~ 1213)","겐포 (1213 ~ 1219)","조큐 (1219 ~ 1222)","조오 (1222 ~ 1224)","겐닌 (1224 ~ 1225)","가로쿠 (1225 ~ 1227)","안테이 (1227 ~ 1229)","간키 (1229 ~ 1232)","조에이 (1232 ~ 1233)","덴푸쿠 (1233 ~ 1234)","분랴쿠 (1234 ~ 1235)","가테이 (1235 ~ 1238)","랴쿠닌 (1238 ~ 1239)","엔오 (1239 ~ 1240)","닌지 (1240 ~ 1243)","간겐 (1243 ~ 1247)","호지 (1247 ~ 1249)","겐초 (1249 ~ 1256)","고겐 (1256 ~ 1257)","쇼카 (1257 ~ 1259)","쇼겐 (1259 ~ 1260)","분오 (1260 ~ 1261)","고초 (1261 ~ 1264)","분에이 (1264 ~ 1275)","겐지 (1275 ~ 1278)","고안 (1278 ~ 1288)","쇼오 (1288 ~ 1293)","에이닌 (1293 ~ 1299)","쇼안 (1299 ~ 1302)","겐겐 (1302 ~ 1303)","가겐 (1303 ~ 1306)","도쿠지 (1306 ~ 1308)","엔쿄 (1308 ~ 1311)","오초 (1311 ~ 1312)","쇼와 (1312 ~ 1317)","분포 (1317 ~ 1319)","겐오 (1319 ~ 1321)","겐코 (1321 ~ 1324)","쇼추 (1324 ~ 1326)","가랴쿠 (1326 ~ 1329)","겐토쿠 (1329 ~ 1331)","겐코 (1331 ~ 1334)","겐무 (1334 ~ 1336)","엔겐 (1336 ~ 1340)","고코쿠 (1340 ~ 1346)","쇼헤이 (1346 ~ 1370)","겐토쿠 (1370 ~ 1372)","분추 (1372 ~ 1375)","덴주 (1375 ~ 1379)","고랴쿠 (1379 ~ 1381)","고와 (1381 ~ 1384)","겐추 (1384 ~ 1392)","메이토쿠 (1384 ~ 1387)","가쿄 (1387 ~ 1389)","고오 (1389 ~ 1390)","메이토쿠 (1390 ~ 1394)","오에이 (1394 ~ 1428)","쇼초 (1428 ~ 1429)","에이쿄 (1429 ~ 1441)","가키쓰 (1441 ~ 1444)","분안 (1444 ~ 1449)","호토쿠 (1449 ~ 1452)","교토쿠 (1452 ~ 1455)","고쇼 (1455 ~ 1457)","조로쿠 (1457 ~ 1460)","간쇼 (1460 ~ 1466)","분쇼 (1466 ~ 1467)","오닌 (1467 ~ 1469)","분메이 (1469 ~ 1487)","조쿄 (1487 ~ 1489)<","엔토쿠 (1489 ~ 1492)","메이오 (1492 ~ 1501)","분키 (1501 ~ 1504)","에이쇼 (1504 ~ 1521)","다이에이 (1521 ~ 1528)","교로쿠 (1528 ~ 1532)","덴분 (1532 ~ 1555)","고지 (1555 ~ 1558)","에이로쿠 (1558 ~ 1570)","겐키 (1570 ~ 1573)","덴쇼 (1573 ~ 1592)","분로쿠 (1592 ~ 1596)","게이초 (1596 ~ 1615)","겐나 (1615 ~ 1624)","간에이 (1624 ~ 1644)","쇼호 (1644 ~ 1648)","게이안 (1648 ~ 1652)","조오 (1652 ~ 1655)","메이레키 (1655 ~ 1658)","만지 (1658 ~ 1661)","간분 (1661 ~ 1673)","엔포 (1673 ~ 1681)","덴나 (1681 ~ 1684)","조쿄 (1684 ~ 1688)","겐로쿠 (1688 ~ 1704)","호에이 (1704 ~ 1711)","쇼토쿠 (1711 ~ 1716)","교호 (1716 ~ 1736)","겐분 (1736 ~ 1741)","간포 (1741 ~ 1744)","엔쿄 (1744 ~ 1748)","간엔 (1748 ~ 1751)","호레키 (1751 ~ 1764)","메이와 (1764 ~ 1772)","안에이 (1772 ~ 1781)","덴메이 (1781 ~ 1789)","간세이 (1789 ~ 1801)","교와 (1801 ~ 1804)","분카 (1804 ~ 1818)","분세이 (1818 ~ 1830)","덴포 (1830 ~ 1844)","고카 (1844 ~ 1848)","가에이 (1848 ~ 1854)","안세이 (1854 ~ 1860)","만엔 (1860 ~ 1861)","분큐 (1861 ~ 1864)","겐지 (1864 ~ 1865)","게이오 (1865 ~ 1868)","메이지","다이쇼","쇼와","헤이세이","중화민국전","중화민국","({currency}{number})","Tut","Babah","Hatur","Kiyahk","Tubah","Baramundah","Ba'unah","Abib","Misra","Nasi","Mäskäräm","Teqemt","T'er","Yäkatit","Mägabit","Miyazya","Säne","Nähase","Pagumän","mrt.","mei","januari","februari","maart","augustus","zo","wo","do","vr","za","zondag","maandag","dinsdag","woensdag","donderdag","vrijdag","zaterdag","v.C.","n.C.","vgj","gj","v.Chr.","n.Chr.","v.g.j.","g.j.","Voor Christus","na Christus","vóór gewone jaartelling","gewone jaartelling","Tisjrie","Chesjwan","Sjevat","Adar A","Ijar","Tammoez","Elloel","Adar B","Vaishakha","Jyeshtha","Aashaadha","Shraavana","Bhaadrapada","Ashvina","Kaartika","Pausha","Maagha","Phaalguna","Moeh.","Joem. I","Joem. II","Sja.","Sjaw.","Doe al k.","Doe al h.","Moeharram","Rabiʻa al awal","Rabiʻa al thani","Joemadʻal awal","Joemadʻal thani","Sjaʻaban","Sjawal","Doe al kaʻaba","Doe al hizja","Saʻna Hizjria","{currency} {number}-","C$","FJ$","SI$","Mês 1","Mês 2","Mês 3","Mês 4","Mês 5","Mês 6","Mês 7","Mês 8","Mês 9","Mês 10","Mês 11","Mês 12","jan","fev","abr","jun","jul","out","dez","janeiro","fevereiro","março","maio","junho","julho","setembro","outubro","novembro","dezembro","seg","qua","qui","sex","segunda-feira","terça-feira","quarta-feira","quinta-feira","sexta-feira","Antes de Cristo","Ano do Senhor","Antes de R.O.C.","Esc.","kiahk","aug","sep","okt","dec","augusti","sö","må","lö","sön","mån","tis","ons","tors","fre","lör","söndag","måndag","tisdag","lördag","före Kristus","efter Kristus","före västerländsk tideräkning","västerländsk tideräkning","fm","em","tishrí","heshván","kislév","tevét","shevát","adár I","adár","nisán","ijjár","siván","tammúz","elúl","adár II","Saka-eran","muharram","rabi’ al-awwal","rabi’ al-akhir","jumada-l-ula","jumada-l-akhira","sha’ban","shawwal","dhu-l-ga’da","dhu-l-hijja","Taika (645–650)","Hakuchi (650–671)","Hakuhō (672–686)","Shuchō (686–701)","Taihō (701–704)","Keiun (704–708)","Wadō (708–715)","Reiki (715–717)","Yōrō (717–724)","Jinki (724–729)","Tempyō (729–749)","Tempyō-kampō (749–749)","Tempyō-shōhō (749–757)","Tempyō-hōji (757–765)","Temphō-jingo (765–767)","Jingo-keiun (767–770)","Hōki (770–780)","Ten-ō (781–782)","Enryaku (782–806)","Daidō (806–810)","Kōnin (810–824)","Tenchō (824–834)","Jōwa (834–848)","Kajō (848–851)","Ninju (851–854)","Saiko (854–857)","Tennan (857–859)","Jōgan (859–877)","Genkei (877–885)","Ninna (885–889)","Kampyō (889–898)","Shōtai (898–901)","Engi (901–923)","Enchō (923–931)","Shōhei (931–938)","Tengyō (938–947)","Tenryaku (947–957)","Tentoku (957–961)","Ōwa (961–964)","Kōhō (964–968)","Anna (968–970)","Tenroku (970–973)","Ten-en (973–976)","Jōgen (976–978)","Tengen (978–983)","Eikan (983–985)","Kanna (985–987)","Ei-en (987–989)","Eiso (989–990)","Shōryaku (990–995)","Chōtoku (995–999)","Chōhō (999–1004)","Kankō (1004–1012)","Chōwa (1012–1017)","Kannin (1017–1021)","Jian (1021–1024)","Manju (1024–1028)","Chōgen (1028–1037)","Chōryaku (1037–1040)","Chōkyū (1040–1044)","Kantoku (1044–1046)","Eishō (1046–1053)","Tengi (1053–1058)","Kōhei (1058–1065)","Jiryaku (1065–1069)","Enkyū (1069–1074)","Shōho (1074–1077)","Shōryaku (1077–1081)","Eiho (1081–1084)","Ōtoku (1084–1087)","Kanji (1087–1094)","Kaho (1094–1096)","Eichō (1096–1097)","Shōtoku (1097–1099)","Kōwa (1099–1104)","Chōji (1104–1106)","Kashō (1106–1108)","Tennin (1108–1110)","Ten-ei (1110–1113)","Eikyū (1113–1118)","Gen-ei (1118–1120)","Hoan (1120–1124)","Tenji (1124–1126)","Daiji (1126–1131)","Tenshō (1131–1132)","Chōshō (1132–1135)","Hoen (1135–1141)","Eiji (1141–1142)","Kōji (1142–1144)","Tenyō (1144–1145)","Kyūan (1145–1151)","Ninpei (1151–1154)","Kyūju (1154–1156)","Hogen (1156–1159)","Heiji (1159–1160)","Eiryaku (1160–1161)","Ōho (1161–1163)","Chōkan (1163–1165)","Eiman (1165–1166)","Nin-an (1166–1169)","Kaō (1169–1171)","Shōan (1171–1175)","Angen (1175–1177)","Jishō (1177–1181)","Yōwa (1181–1182)","Juei (1182–1184)","Genryuku (1184–1185)","Bunji (1185–1190)","Kenkyū (1190–1199)","Shōji (1199–1201)","Kennin (1201–1204)","Genkyū (1204–1206)","Ken-ei (1206–1207)","Shōgen (1207–1211)","Kenryaku (1211–1213)","Kenpō (1213–1219)","Shōkyū (1219–1222)","Jōō (1222–1224)","Gennin (1224–1225)","Karoku (1225–1227)","Antei (1227–1229)","Kanki (1229–1232)","Jōei (1232–1233)","Tempuku (1233–1234)","Bunryaku (1234–1235)","Katei (1235–1238)","Ryakunin (1238–1239)","En-ō (1239–1240)","Ninji (1240–1243)","Kangen (1243–1247)","Hōji (1247–1249)","Kenchō (1249–1256)","Kōgen (1256–1257)","Shōka (1257–1259)","Shōgen (1259–1260)","Bun-ō (1260–1261)","Kōchō (1261–1264)","Bun-ei (1264–1275)","Kenji (1275–1278)","Kōan (1278–1288)","Shōō (1288–1293)","Einin (1293–1299)","Shōan (1299–1302)","Kengen (1302–1303)","Kagen (1303–1306)","Tokuji (1306–1308)","Enkei (1308–1311)","Ōchō (1311–1312)","Shōwa (1312–1317)","Bunpō (1317–1319)","Genō (1319–1321)","Genkyō (1321–1324)","Shōchū (1324–1326)","Kareki (1326–1329)","Gentoku (1329–1331)","Genkō (1331–1334)","Kemmu (1334–1336)","Engen (1336–1340)","Kōkoku (1340–1346)","Shōhei (1346–1370)","Kentoku (1370–1372)","Bunchū (1372–1375)","Tenju (1375–1379)","Kōryaku (1379–1381)","Kōwa (1381–1384)","Genchū (1384–1392)","Meitoku (1384–1387)","Kakei (1387–1389)","Kōō (1389–1390)","Meitoku (1390–1394)","Ōei (1394–1428)","Shōchō (1428–1429)","Eikyō (1429–1441)","Kakitsu (1441–1444)","Bun-an (1444–1449)","Hōtoku (1449–1452)","Kyōtoku (1452–1455)","Kōshō (1455–1457)","Chōroku (1457–1460)","Kanshō (1460–1466)","Bunshō (1466–1467)","Ōnin (1467–1469)","Bunmei (1469–1487)","Chōkyō (1487–1489)","Entoku (1489–1492)","Meiō (1492–1501)","Bunki (1501–1504)","Eishō (1504–1521)","Taiei (1521–1528)","Kyōroku (1528–1532)","Tenmon (1532–1555)","Kōji (1555–1558)","Eiroku (1558–1570)","Genki (1570–1573)","Tenshō (1573–1592)","Bunroku (1592–1596)","Keichō (1596–1615)","Genwa (1615–1624)","Kan-ei (1624–1644)","Shōho (1644–1648)","Keian (1648–1652)","Shōō (1652–1655)","Meiryaku (1655–1658)","Manji (1658–1661)","Kanbun (1661–1673)","Enpō (1673–1681)","Tenwa (1681–1684)","Jōkyō (1684–1688)","Genroku (1688–1704)","Hōei (1704–1711)","Shōtoku (1711–1716)","Kyōhō (1716–1736)","Genbun (1736–1741)","Kanpō (1741–1744)","Enkyō (1744–1748)","Kan-en (1748–1751)","Hōryaku (1751–1764)","Meiwa (1764–1772)","An-ei (1772–1781)","Tenmei (1781–1789)","Kansei (1789–1801)","Kyōwa (1801–1804)","Bunka (1804–1818)","Bunsei (1818–1830)","Tenpō (1830–1844)","Kōka (1844–1848)","Kaei (1848–1854)","Ansei (1854–1860)","Man-en (1860–1861)","Bunkyū (1861–1864)","Genji (1864–1865)","Keiō (1865–1868)","farvardin","ordibehesht","khordād","tir","mordād","shahrivar","mehr","ābān","āzar","dey","bahman","esfand","före R.K.","R.K.","¤¤¤","Bds$","Tk","BM$","BN$","BR$","BS$","BZ$","CAN$","Dkr","RD$","EG£","GB£","GY$","Ikr","JM$","Ls","NKr","SY£","TH฿","TW$","VN₫","{day} {month} {year} {weekday}  {hour}:{minute}:{second}","{day} {month} {year} {weekday} {ampm} {hour}:{minute}:{second}","{day} {month} {year} {weekday}","Tût","Bâbe","Keyhek","Tûbe","Imşir","Bermuhat","Bermude","Peyştes","Bune","Ebip","Mısrî","Nesî","Tikimt","Hidar","Yakatit","Magabit","Ginbot","Nehasa","Pagumiene","Ş","Oca","Şub","Nis","Haz","Tem","Ağu","Eyl","Eki","Kas","Ara","Ocak","Şubat","Mart","Mayıs","Haziran","Temmuz","Ağustos","Eylül","Ekim","Kasım","Aralık","Pa","Pt","Ça","Pe","Cu","Ct","Paz","Pzt","Sal","Çar","Per","Cum","Cmt","Pazar","Pazartesi","Salı","Çarşamba","Perşembe","Cuma","Cumartesi","MÖ","MS","İÖ","İS","Milattan Önce","Milattan Sonra","ÖÖ","ÖS","Tişri","Heşvan","Şevat","Veadar","İyar","Muharrem","Safer","Rebiülevvel","Rebiülahir","Cemaziyelevvel","Cemaziyelahir","Recep","Şaban","Ramazan","Şevval","Zilkade","Zilhicce","Hicri","Ferverdin","Ordibeheşt","Hordad","Şehriver","Azer","Behmen","Esfend","%{number}","-%{number}","₺","{year}年{month}月{day}日{weekday} {hour}:{minute}:{second}","{year}年{month}月{day}日{weekday} {ampm}{hour}:{minute}:{second}","{year}年{month}月{day}日{weekday}","佛历","13月","一月","十三月","周日","周一","周二","周三","周四","周五","周六","星期日","星期一","星期二","星期三","星期四","星期五","星期六","公元前","公元","上午","下午","闰7月","闰七月","希伯来历","印度历","回历","大化 (645–650)","白雉 (650–671)","白凤 (672–686)","朱鸟 (686–701)","大宝 (701–704)","庆云 (704–708)","和铜 (708–715)","灵龟 (715–717)","养老 (717–724)","神龟 (724–729)","天平 (729–749)","天平感宝 (749–749)","天平胜宝 (749–757)","天平宝字 (757–765)","天平神护 (765–767)","神护景云 (767–770)","宝龟 (770–780)","天应 (781–782)","延历 (782–806)","大同 (806–810)","弘仁 (810–824)","天长 (824–834)","承和 (834–848)","嘉祥 (848–851)","仁寿 (851–854)","齐衡 (854–857)","天安 (857–859)","贞观 (859–877)","元庆 (877–885)","仁和 (885–889)","宽平 (889–898)","昌泰 (898–901)","延喜 (901–923)","延长 (923–931)","承平 (931–938)","天庆 (938–947)","天历 (947–957)","天德 (957–961)","应和 (961–964)","康保 (964–968)","安和 (968–970)","天禄 (970–973)","天延 (973–976)","贞元 (976–978)","天元 (978–983)","永观 (983–985)","宽和 (985–987)","永延 (987–989)","永祚 (989–990)","正历 (990–995)","长德 (995–999)","长保 (999–1004)","宽弘 (1004–1012)","长和 (1012–1017)","宽仁 (1017–1021)","治安 (1021–1024)","万寿 (1024–1028)","长元 (1028–1037)","长历 (1037–1040)","长久 (1040–1044)","宽德 (1044–1046)","永承 (1046–1053)","天喜 (1053–1058)","康平 (1058–1065)","治历 (1065–1069)","延久 (1069–1074)","承保 (1074–1077)","正历 (1077–1081)","永保 (1081–1084)","应德 (1084–1087)","宽治 (1087–1094)","嘉保 (1094–1096)","永长 (1096–1097)","承德 (1097–1099)","康和 (1099–1104)","长治 (1104–1106)","嘉承 (1106–1108)","天仁 (1108–1110)","天永 (1110–1113)","永久 (1113–1118)","元永 (1118–1120)","保安 (1120–1124)","天治 (1124–1126)","大治 (1126–1131)","天承 (1131–1132)","长承 (1132–1135)","保延 (1135–1141)","永治 (1141–1142)","康治 (1142–1144)","天养 (1144–1145)","久安 (1145–1151)","仁平 (1151–1154)","久寿 (1154–1156)","保元 (1156–1159)","平治 (1159–1160)","永历 (1160–1161)","应保 (1161–1163)","长宽 (1163–1165)","永万 (1165–1166)","仁安 (1166–1169)","嘉应 (1169–1171)","承安 (1171–1175)","安元 (1175–1177)","治承 (1177–1181)","养和 (1181–1182)","寿永 (1182–1184)","元历 (1184–1185)","文治 (1185–1190)","建久 (1190–1199)","正治 (1199–1201)","建仁 (1201–1204)","元久 (1204–1206)","建永 (1206–1207)","承元 (1207–1211)","建历 (1211–1213)","建保 (1213–1219)","承久 (1219–1222)","贞应 (1222–1224)","元仁 (1224–1225)","嘉禄 (1225–1227)","安贞 (1227–1229)","宽喜 (1229–1232)","贞永 (1232–1233)","天福 (1233–1234)","文历 (1234–1235)","嘉祯 (1235–1238)","历仁 (1238–1239)","延应 (1239–1240)","仁治 (1240–1243)","宽元 (1243–1247)","宝治 (1247–1249)","建长 (1249–1256)","康元 (1256–1257)","正嘉 (1257–1259)","正元 (1259–1260)","文应 (1260–1261)","弘长 (1261–1264)","文永 (1264–1275)","建治 (1275–1278)","弘安 (1278–1288)","正应 (1288–1293)","永仁 (1293–1299)","正安 (1299–1302)","干元 (1302–1303)","嘉元 (1303–1306)","德治 (1306–1308)","延庆 (1308–1311)","应长 (1311–1312)","正和 (1312–1317)","文保 (1317–1319)","元应 (1319–1321)","元亨 (1321–1324)","正中 (1324–1326)","嘉历 (1326–1329)","元德 (1329–1331)","元弘 (1331–1334)","建武 (1334–1336)","延元 (1336–1340)","兴国 (1340–1346)","正平 (1346–1370)","建德 (1370–1372)","文中 (1372–1375)","天授 (1375–1379)","康历 (1379–1381)","弘和 (1381–1384)","元中 (1384–1392)","至德 (1384–1387)","嘉庆 (1387–1389)","康应 (1389–1390)","明德 (1390–1394)","应永 (1394–1428)","正长 (1428–1429)","永享 (1429–1441)","嘉吉 (1441–1444)","文安 (1444–1449)","宝德 (1449–1452)","享德 (1452–1455)","康正 (1455–1457)","长禄 (1457–1460)","宽正 (1460–1466)","文正 (1466–1467)","应仁 (1467–1469)","文明 (1469–1487)","长享 (1487–1489)","延德 (1489–1492)","明应 (1492–1501)","文龟 (1501–1504)","永正 (1504–1521)","大永 (1521–1528)","享禄 (1528–1532)","天文 (1532–1555)","弘治 (1555–1558)","永禄 (1558–1570)","元龟 (1570–1573)","天正 (1573–1592)","文禄 (1592–1596)","庆长 (1596–1615)","元和 (1615–1624)","宽永 (1624–1644)","正保 (1644–1648)","庆安 (1648–1652)","承应 (1652–1655)","明历 (1655–1658)","万治 (1658–1661)","宽文 (1661–1673)","延宝 (1673–1681)","天和 (1681–1684)","贞享 (1684–1688)","元禄 (1688–1704)","宝永 (1704–1711)","正德 (1711–1716)","享保 (1716–1736)","元文 (1736–1741)","宽保 (1741–1744)","延享 (1744–1748)","宽延 (1748–1751)","宝历 (1751–1764)","明和 (1764–1772)","安永 (1772–1781)","天明 (1781–1789)","宽政 (1789–1801)","享和 (1801–1804)","文化 (1804–1818)","文政 (1818–1830)","天保 (1830–1844)","弘化 (1844–1848)","嘉永 (1848–1854)","安政 (1854–1860)","万延 (1860–1861)","文久 (1861–1864)","元治 (1864–1865)","庆应 (1865–1868)","波斯历"],b=[];b[0]=[[a[0],a[1],a[2],a[3],a[4],a[5],a[6],a[7],a[8],a[9],a[10],a[11],a[12]],{"weekday":a[13],"day":a[14],"month":a[13],"year":a[14],"hour":a[14],"minute":a[15],"second":a[15],"pattern":a[16],"pattern12":a[17]},{"weekday":a[13],"day":a[14],"month":a[13],"year":a[14],"pattern":a[18]},{"day":a[14],"month":a[13],"year":a[14],"pattern":a[19]},{"day":a[14],"month":a[14],"year":a[14],"pattern":a[20]},{"month":a[14],"year":a[14],"pattern":a[21]},{"month":a[13],"year":a[14],"pattern":a[22]},{"day":a[14],"month":a[13],"pattern":a[23]},{"day":a[14],"month":a[14],"pattern":a[24]},{"hour":a[14],"minute":a[15],"second":a[15],"pattern":a[25],"pattern12":a[26]},{"hour":a[14],"minute":a[15],"pattern":a[27],"pattern12":a[28]},[a[29]],[a[30],a[31],a[32],a[33],a[34],a[35],a[36],a[37],a[38],a[39],a[40],a[41]],[a[42],a[43],a[44],a[45],a[46],a[47],a[48],a[49],a[50],a[51],a[52],a[53],a[54]],[a[55],a[56]],[a[57],a[58],a[59],a[60],a[61],a[62],a[63],a[64],a[65],a[66],a[67],a[68],a[69]],[a[55]],[a[70],a[71],a[72],a[73],a[72],a[70],a[70],a[73],a[74],a[75],a[76],a[77]],[a[78],a[79],a[80],a[81],a[82],a[83],a[84],a[85],a[86],a[87],a[88],a[89]],[a[90],a[91],a[92],a[93],a[82],a[94],a[95],a[96],a[97],a[98],a[99],a[100]],[a[101],a[102],a[103],a[104],a[105],a[106],a[107]],[a[108],a[109],a[110],a[111],a[112],a[113],a[114]],[a[115],a[116],a[117],a[118],a[119],a[120],a[121]],[a[122],a[123],a[124],a[125]],[a[126],a[127],a[128],a[129]],[a[126],a[127],a[130],a[131]],{"am":a[132],"pm":a[133]},[a[134],a[135],a[136],a[137],a[138],a[139],a[140],a[141],a[142],a[143],a[144],a[145],a[146],a[147]],[a[132]],[a[148],a[149],a[150],a[151],a[152],a[153],a[154],a[155],a[156],a[157],a[158],a[159]],[a[160]],[a[161],a[162],a[163],a[164],a[165],a[166],a[167],a[168],a[169],a[170],a[171],a[172]],[a[173],a[174],a[175],a[176],a[177],a[178],a[179],a[180],a[181],a[182],a[183],a[184]],[a[185]],[a[186],a[187],a[188],a[189],a[190],a[191],a[192],a[193],a[194],a[195],a[196],a[197],a[198],a[199],a[200],a[201],a[202],a[203],a[204],a[205],a[206],a[207],a[208],a[209],a[210],a[211],a[212],a[213],a[214],a[215],a[216],a[217],a[218],a[219],a[220],a[221],a[222],a[223],a[224],a[225],a[226],a[227],a[228],a[229],a[230],a[231],a[232],a[233],a[234],a[235],a[236],a[237],a[238],a[239],a[240],a[241],a[242],a[243],a[244],a[245],a[246],a[247],a[248],a[249],a[250],a[251],a[252],a[253],a[254],a[255],a[256],a[257],a[258],a[259],a[260],a[261],a[262],a[263],a[264],a[265],a[266],a[267],a[268],a[269],a[270],a[271],a[272],a[273],a[274],a[275],a[276],a[277],a[278],a[279],a[280],a[281],a[282],a[283],a[284],a[285],a[286],a[287],a[288],a[289],a[290],a[291],a[292],a[293],a[294],a[295],a[296],a[297],a[298],a[299],a[300],a[301],a[302],a[303],a[304],a[305],a[306],a[307],a[308],a[309],a[310],a[311],a[312],a[313],a[314],a[315],a[316],a[317],a[318],a[319],a[320],a[321],a[322],a[323],a[324],a[325],a[326],a[327],a[328],a[329],a[330],a[331],a[332],a[333],a[334],a[335],a[336],a[337],a[338],a[339],a[340],a[341],a[342],a[343],a[344],a[345],a[346],a[347],a[348],a[349],a[350],a[351],a[352],a[353],a[354],a[355],a[356],a[357],a[358],a[359],a[360],a[361],a[362],a[363],a[364],a[365],a[366],a[367],a[368],a[369],a[370],a[371],a[372],a[373],a[374],a[375],a[376],a[377],a[378],a[379],a[380],a[381],a[382],a[383],a[384],a[385],a[386],a[387],a[388],a[389],a[390],a[391],a[392],a[393],a[394],a[395],a[396],a[397],a[398],a[399],a[400],a[401],a[402],a[403],a[404],a[405],a[406],a[407],a[408],a[409],a[410],a[411],a[412],a[413],a[414],a[415],a[416],a[417],a[72],a[418],a[74],a[419]],[a[186],a[187],a[188],a[189],a[190],a[191],a[192],a[193],a[194],a[195],a[196],a[197],a[198],a[199],a[200],a[201],a[202],a[203],a[204],a[205],a[206],a[207],a[208],a[209],a[210],a[211],a[212],a[213],a[214],a[215],a[216],a[217],a[218],a[219],a[220],a[221],a[222],a[223],a[224],a[225],a[226],a[227],a[228],a[229],a[230],a[231],a[232],a[233],a[234],a[235],a[236],a[237],a[238],a[239],a[240],a[241],a[242],a[243],a[244],a[245],a[246],a[247],a[248],a[249],a[250],a[251],a[252],a[253],a[254],a[255],a[256],a[257],a[258],a[259],a[260],a[261],a[262],a[263],a[264],a[265],a[266],a[267],a[268],a[269],a[270],a[271],a[272],a[273],a[274],a[275],a[276],a[277],a[278],a[279],a[280],a[281],a[282],a[283],a[284],a[285],a[286],a[287],a[288],a[289],a[290],a[291],a[292],a[293],a[294],a[295],a[296],a[297],a[298],a[299],a[300],a[301],a[302],a[303],a[304],a[305],a[306],a[307],a[308],a[309],a[310],a[311],a[312],a[313],a[314],a[315],a[316],a[317],a[318],a[319],a[320],a[321],a[322],a[323],a[324],a[325],a[326],a[327],a[328],a[329],a[330],a[331],a[332],a[333],a[334],a[335],a[336],a[337],a[338],a[339],a[340],a[341],a[342],a[343],a[344],a[345],a[346],a[420],a[348],a[349],a[350],a[421],a[352],a[353],a[354],a[355],a[356],a[357],a[358],a[359],a[360],a[361],a[362],a[363],a[364],a[365],a[366],a[367],a[368],a[369],a[370],a[371],a[372],a[373],a[374],a[375],a[376],a[377],a[378],a[379],a[380],a[381],a[382],a[383],a[384],a[385],a[386],a[387],a[388],a[389],a[390],a[391],a[392],a[393],a[394],a[395],a[396],a[397],a[398],a[399],a[400],a[401],a[402],a[403],a[404],a[405],a[406],a[407],a[408],a[409],a[410],a[411],a[412],a[413],a[414],a[415],a[416],a[417],a[422],a[423],a[424],a[425]],[a[426],a[427],a[428],a[429],a[430],a[431],a[432],a[433],a[434],a[435],a[436],a[437]],[a[438]],[a[439],a[440]],[a[441]],{"positivePattern":a[442],"negativePattern":a[443]},{"positivePattern":a[444],"negativePattern":a[445]},{"positivePattern":a[446],"negativePattern":a[447]},{"decimal":a[448],"group":a[449],"nan":a[450],"percent":a[451],"infinity":a[452]},{"AUD":a[453],"BRL":a[454],"CAD":a[455],"CNY":a[456],"DKK":a[457],"EUR":a[458],"GBP":a[459],"HKD":a[460],"ILS":a[461],"INR":a[462],"JPY":a[463],"KRW":a[464],"MXN":a[465],"NZD":a[466],"THB":a[467],"TWD":a[468],"USD":a[469],"VND":a[470],"XAF":a[471],"XCD":a[472],"XOF":a[473],"XPF":a[474]},{"weekday":a[13],"day":a[14],"month":a[13],"year":a[14],"hour":a[14],"minute":a[15],"second":a[15],"pattern":a[475],"pattern12":a[476]},{"weekday":a[13],"day":a[14],"month":a[13],"year":a[14],"pattern":a[477]},{"day":a[14],"month":a[14],"year":a[14],"pattern":a[478]},{"month":a[14],"year":a[14],"pattern":a[479]},{"day":a[14],"month":a[14],"pattern":a[480]},{"hour":a[14],"minute":a[15],"second":a[15],"pattern":a[481],"pattern12":a[482]},{"hour":a[14],"minute":a[15],"pattern":a[483],"pattern12":a[484]},[a[485],a[486],a[487],a[488],a[489],a[490],a[491],a[492],a[493],a[494],a[495],a[496]],[a[497],a[498],a[487],a[499],a[489],a[490],a[491],a[500],a[501],a[502],a[503],a[504]],[a[505],a[506],a[507],a[508],a[509],a[510],a[511]],[a[512],a[513],a[514],a[515],a[516],a[517],a[518]],[a[519],a[520],a[521],a[522]],[a[519],a[520],a[523],a[524]],[a[519],a[520],a[525],a[526]],{"am":a[527],"pm":a[528]},{"positivePattern":a[529],"negativePattern":a[530]},{"decimal":a[449],"group":a[531],"nan":a[450],"percent":a[451],"infinity":a[452]},{"ATS":a[532],"AUD":a[453],"BRL":a[454],"CAD":a[455],"CNY":a[456],"EUR":a[458],"GBP":a[459],"HKD":a[460],"ILS":a[461],"INR":a[462],"JPY":a[533],"KRW":a[464],"MXN":a[465],"NZD":a[466],"THB":a[467],"TWD":a[468],"USD":a[469],"VND":a[470],"XAF":a[471],"XCD":a[472],"XOF":a[473],"XPF":a[474]},{"weekday":a[13],"month":a[13],"day":a[14],"year":a[14],"hour":a[14],"minute":a[15],"second":a[15],"pattern":a[534],"pattern12":a[535]},{"weekday":a[13],"month":a[13],"day":a[14],"year":a[14],"pattern":a[536]},{"month":a[13],"day":a[14],"year":a[14],"pattern":a[537]},{"month":a[13],"day":a[14],"pattern":a[538]},{"month":a[14],"day":a[14],"pattern":a[539]},[a[540],a[541],a[542],a[543],a[544],a[545],a[546],a[547],a[548],a[549],a[550],a[551]],[a[552],a[553],a[554],a[555],a[556],a[557],a[558],a[559],a[560],a[561],a[562],a[563]],[a[564],a[565],a[566],a[567],a[568],a[569],a[570],a[571],a[572],a[573],a[574],a[575]],[a[576],a[577],a[578],a[499],a[568],a[579],a[580],a[500],a[501],a[581],a[503],a[582]],[a[583],a[584],a[585],a[586],a[587],a[588],a[589]],[a[590],a[591],a[592],a[593],a[594],a[595],a[596]],[a[597],a[598],a[599],a[600],a[601],a[602],a[603]],[a[604],a[73]],[a[605],a[606],a[607],a[608]],[a[609],a[610],a[611],a[612]],{"positivePattern":a[613],"negativePattern":a[614]},{"positivePattern":a[615],"negativePattern":a[616]},{"decimal":a[449],"group":a[448],"nan":a[450],"percent":a[451],"infinity":a[452]},{"AUD":a[469],"BRL":a[454],"CAD":a[455],"CNY":a[456],"EUR":a[458],"GBP":a[459],"HKD":a[460],"ILS":a[461],"INR":a[462],"JPY":a[533],"KRW":a[464],"MXN":a[465],"NZD":a[466],"THB":a[467],"TWD":a[468],"USD":a[617],"VND":a[470],"XAF":a[471],"XCD":a[472],"XOF":a[473],"XPF":a[474]},{"year":a[14],"month":a[15],"day":a[15],"pattern":a[618]},{"year":a[14],"month":a[15],"pattern":a[619]},{"month":a[15],"day":a[15],"pattern":a[620]},{"AUD":a[621],"BRL":a[454],"CAD":a[469],"CNY":a[456],"EUR":a[458],"GBP":a[459],"HKD":a[460],"ILS":a[461],"INR":a[462],"JPY":a[533],"KRW":a[464],"MXN":a[465],"NZD":a[466],"THB":a[467],"TWD":a[468],"USD":a[617],"VND":a[470],"XAF":a[471],"XCD":a[472],"XOF":a[473],"XPF":a[474]},{"weekday":a[13],"day":a[14],"month":a[13],"year":a[14],"hour":a[14],"minute":a[15],"second":a[15],"pattern":a[622],"pattern12":a[623]},{"weekday":a[13],"day":a[14],"month":a[13],"year":a[14],"pattern":a[624]},{"day":a[14],"month":a[13],"year":a[14],"pattern":a[625]},{"day":a[15],"month":a[15],"year":a[14],"pattern":a[20]},{"month":a[15],"year":a[14],"pattern":a[21]},{"day":a[14],"month":a[13],"pattern":a[626]},{"day":a[15],"month":a[15],"pattern":a[24]},[a[627],a[628],a[629],a[630],a[631],a[632],a[633],a[634],a[635],a[636],a[637],a[638]],{"am":a[639],"pm":a[640]},[a[641]],{"AUD":a[453],"BRL":a[454],"CAD":a[455],"CNY":a[456],"EUR":a[458],"GBP":a[459],"HKD":a[460],"ILS":a[461],"INR":a[462],"JPY":a[533],"KRW":a[464],"MXN":a[465],"NZD":a[466],"THB":a[467],"TWD":a[468],"USD":a[469],"VND":a[470],"XAF":a[471],"XCD":a[472],"XOF":a[473],"XPF":a[474]},{"weekday":a[13],"day":a[14],"month":a[13],"year":a[14],"hour":a[14],"minute":a[15],"second":a[15],"pattern":a[642],"pattern12":a[643]},{"weekday":a[13],"day":a[14],"month":a[13],"year":a[14],"pattern":a[644]},{"day":a[14],"month":a[13],"year":a[14],"pattern":a[645]},[a[186],a[187],a[188],a[189],a[190],a[191],a[192],a[193],a[194],a[195],a[196],a[197],a[198],a[199],a[200],a[201],a[202],a[203],a[204],a[205],a[206],a[207],a[208],a[209],a[210],a[211],a[212],a[213],a[214],a[215],a[216],a[217],a[218],a[219],a[220],a[221],a[222],a[223],a[224],a[225],a[226],a[227],a[228],a[229],a[230],a[231],a[232],a[233],a[234],a[235],a[236],a[237],a[238],a[239],a[240],a[241],a[242],a[243],a[244],a[245],a[246],a[247],a[248],a[249],a[250],a[251],a[252],a[253],a[254],a[255],a[256],a[257],a[258],a[259],a[260],a[261],a[262],a[263],a[264],a[265],a[266],a[267],a[268],a[269],a[270],a[271],a[272],a[273],a[274],a[275],a[276],a[277],a[278],a[279],a[280],a[281],a[282],a[283],a[284],a[285],a[286],a[287],a[288],a[289],a[290],a[291],a[292],a[293],a[294],a[295],a[296],a[297],a[298],a[299],a[300],a[301],a[302],a[303],a[304],a[305],a[306],a[307],a[308],a[309],a[310],a[311],a[312],a[313],a[314],a[315],a[316],a[317],a[318],a[319],a[320],a[321],a[322],a[323],a[324],a[325],a[326],a[327],a[328],a[329],a[330],a[331],a[332],a[333],a[334],a[335],a[336],a[337],a[338],a[339],a[340],a[341],a[342],a[343],a[344],a[345],a[346],a[646],a[348],a[349],a[350],a[647],a[352],a[353],a[354],a[355],a[356],a[357],a[358],a[359],a[360],a[361],a[362],a[363],a[364],a[365],a[366],a[367],a[368],a[369],a[370],a[371],a[372],a[373],a[374],a[375],a[376],a[377],a[378],a[379],a[380],a[381],a[382],a[383],a[384],a[385],a[386],a[387],a[388],a[389],a[390],a[391],a[392],a[393],a[394],a[395],a[396],a[397],a[398],a[399],a[400],a[401],a[402],a[403],a[404],a[405],a[406],a[407],a[408],a[409],a[410],a[411],a[412],a[413],a[414],a[415],a[416],a[417],a[422],a[423],a[424],a[425]],{"AUD":a[621],"BRL":a[454],"CAD":a[455],"CNY":a[456],"EUR":a[458],"GBP":a[459],"HKD":a[469],"ILS":a[461],"INR":a[462],"JPY":a[533],"KRW":a[464],"MXN":a[465],"NZD":a[466],"THB":a[467],"TWD":a[468],"USD":a[617],"VND":a[470],"XAF":a[471],"XCD":a[472],"XOF":a[473],"XPF":a[474]},{"weekday":a[13],"day":a[14],"month":a[13],"year":a[14],"hour":a[14],"minute":a[15],"second":a[15],"pattern":a[648],"pattern12":a[649]},{"weekday":a[13],"day":a[14],"month":a[13],"year":a[14],"pattern":a[650]},{"am":a[651],"pm":a[652]},{"AUD":a[621],"BRL":a[454],"CAD":a[455],"CNY":a[456],"EUR":a[458],"GBP":a[459],"HKD":a[460],"ILS":a[461],"INR":a[462],"JPY":a[533],"KRW":a[464],"MXN":a[465],"NZD":a[466],"THB":a[467],"TWD":a[468],"USD":a[469],"VND":a[470],"XAF":a[471],"XCD":a[472],"XOF":a[473],"XPF":a[474]},{"weekday":a[13],"day":a[14],"month":a[13],"year":a[14],"hour":a[14],"minute":a[15],"second":a[15],"pattern":a[653],"pattern12":a[654]},{"weekday":a[13],"day":a[14],"month":a[13],"year":a[14],"pattern":a[655]},{"positivePattern":a[529],"negativePattern":a[656]},{"AUD":a[621],"BRL":a[454],"CAD":a[455],"CNY":a[456],"EUR":a[458],"GBP":a[459],"HKD":a[460],"ILS":a[461],"INR":a[462],"JPY":a[533],"KRW":a[464],"MXN":a[465],"NZD":a[466],"THB":a[467],"TWD":a[468],"USD":a[617],"VND":a[470],"XAF":a[471],"XCD":a[472],"XOF":a[473],"XPF":a[474]},{"day":a[14],"month":a[15],"year":a[14],"pattern":a[20]},{"AUD":a[621],"BRL":a[454],"CAD":a[455],"CNY":a[456],"EUR":a[458],"GBP":a[459],"HKD":a[460],"ILS":a[461],"INR":a[462],"JPY":a[533],"KRW":a[464],"MXN":a[465],"NZD":a[469],"THB":a[467],"TWD":a[468],"USD":a[617],"VND":a[470],"XAF":a[471],"XCD":a[472],"XOF":a[473],"XPF":a[474]},{"month":a[14],"day":a[14],"year":a[14],"pattern":a[657]},{"AUD":a[621],"BRL":a[454],"CAD":a[455],"CNY":a[456],"EUR":a[458],"GBP":a[459],"HKD":a[460],"ILS":a[461],"INR":a[462],"JPY":a[533],"KRW":a[464],"MXN":a[465],"NZD":a[466],"SGD":a[469],"THB":a[467],"TWD":a[468],"USD":a[617],"VND":a[470],"XAF":a[471],"XCD":a[472],"XOF":a[473],"XPF":a[474]},{"weekday":a[13],"day":a[15],"month":a[13],"year":a[14],"hour":a[14],"minute":a[15],"second":a[15],"pattern":a[658],"pattern12":a[659]},{"weekday":a[13],"day":a[15],"month":a[13],"year":a[14],"pattern":a[624]},{"day":a[15],"month":a[13],"year":a[14],"pattern":a[625]},{"year":a[14],"month":a[15],"day":a[15],"pattern":a[660]},{"day":a[15],"month":a[13],"pattern":a[626]},{"month":a[15],"day":a[15],"pattern":a[539]},{"decimal":a[448],"group":a[661],"nan":a[450],"percent":a[451],"infinity":a[452]},{"AUD":a[621],"BRL":a[454],"CAD":a[455],"CNY":a[456],"EUR":a[458],"GBP":a[459],"HKD":a[460],"ILS":a[461],"INR":a[462],"JPY":a[533],"KRW":a[464],"MXN":a[465],"NZD":a[466],"THB":a[467],"TWD":a[468],"USD":a[469],"VND":a[470],"XAF":a[471],"XCD":a[472],"XOF":a[473],"XPF":a[474],"ZAR":a[662]},{"weekday":a[13],"day":a[14],"month":a[13],"year":a[14],"hour":a[14],"minute":a[15],"second":a[15],"pattern":a[663],"pattern12":a[664]},{"weekday":a[13],"day":a[14],"month":a[13],"year":a[14],"pattern":a[665]},{"day":a[14],"month":a[13],"year":a[14],"pattern":a[666]},{"month":a[14],"year":a[14],"pattern":a[667]},{"month":a[13],"year":a[14],"pattern":a[668]},{"day":a[14],"month":a[13],"pattern":a[669]},[a[670],a[71],a[72],a[73],a[72],a[70],a[70],a[73],a[74],a[75],a[76],a[77]],[a[671],a[79],a[80],a[672],a[673],a[83],a[84],a[674],a[675],a[676],a[88],a[677]],[a[678],a[679],a[680],a[681],a[682],a[683],a[684],a[685],a[686],a[687],a[688],a[689]],[a[690],a[691],a[692],a[693],a[694],a[695],a[696]],[a[697],a[698],a[80],a[699],a[700],a[701],a[702]],[a[703],a[704],a[705],a[706],a[707],a[708],a[709]],[a[710],a[711],a[712],a[713]],[a[714],a[715]],{"am":a[716],"pm":a[717]},[a[718],a[719]],{"positivePattern":a[720],"negativePattern":a[721]},{"ARS":a[469],"AUD":a[453],"CAD":a[455],"ESP":a[722],"EUR":a[458],"MXN":a[465],"USD":a[617],"XAF":a[471],"XCD":a[472]},{"day":a[15],"month":a[15],"year":a[14],"pattern":a[723]},{"month":a[15],"year":a[14],"pattern":a[667]},{"day":a[15],"month":a[15],"pattern":a[724]},{"positivePattern":a[613],"negativePattern":a[530]},{"ARS":a[725],"AUD":a[453],"CAD":a[455],"CLP":a[469],"ESP":a[722],"EUR":a[458],"MXN":a[465],"USD":a[617],"XAF":a[471],"XCD":a[472]},{"ARS":a[725],"AUD":a[453],"CAD":a[455],"COP":a[469],"ESP":a[722],"EUR":a[458],"MXN":a[465],"USD":a[617],"XAF":a[471],"XCD":a[472]},{"ARS":a[725],"AUD":a[453],"CAD":a[455],"ESP":a[722],"EUR":a[458],"MXN":a[465],"USD":a[469],"XAF":a[471],"XCD":a[472]},{"weekday":a[13],"day":a[14],"month":a[13],"year":a[14],"hour":a[15],"minute":a[15],"second":a[15],"pattern":a[663],"pattern12":a[664]},{"hour":a[15],"minute":a[15],"second":a[15],"pattern":a[481],"pattern12":a[482]},{"hour":a[15],"minute":a[15],"pattern":a[483],"pattern12":a[484]},[a[670],a[71],a[726],a[73],a[727],a[728],a[729],a[730],a[74],a[75],a[76],a[77]],[a[671],a[731],a[732],a[672],a[733],a[83],a[84],a[734],a[735],a[676],a[88],a[677]],[a[736],a[737],a[738],a[739],a[740],a[741],a[742]],[a[697],a[698],a[80],a[743],a[700],a[744],a[745]],[a[746],a[747],a[712],a[713]],{"ANG":a[748],"AOA":a[749],"ARS":a[725],"AUD":a[453],"AWG":a[750],"CNY":a[456],"ESP":a[722],"MXN":a[469],"ZMW":a[751]},{"ARS":a[725],"AUD":a[453],"CAD":a[455],"ESP":a[722],"EUR":a[458],"MXN":a[465],"USD":a[617],"UYU":a[469],"XAF":a[471],"XCD":a[472]},{"ARS":a[725],"AUD":a[453],"CAD":a[455],"ESP":a[722],"EUR":a[458],"MXN":a[465],"USD":a[469],"VEF":a[752],"XAF":a[471],"XCD":a[472]},[a[0],a[1],a[2],a[3],a[753],a[4],a[5],a[6],a[7],a[8],a[9],a[10],a[11],a[12]],{"weekday":a[13],"day":a[14],"month":a[13],"year":a[14],"hour":a[14],"minute":a[15],"second":a[15],"pattern":a[754],"pattern12":a[755]},[a[756]],[a[757]],[a[758]],[a[759],a[760],a[761],a[762],a[763],a[764],a[765],a[766],a[767],a[768],a[769],a[770]],[a[771],a[772],a[773],a[774],a[775],a[776],a[777],a[778],a[779],a[780],a[781],a[782]],[a[418],a[604],a[419],a[783],a[418],a[73],a[604],a[604],a[604],a[604],a[73],a[72],a[76]],[a[784],a[785],a[786],a[787],a[788],a[789],a[790],a[791],a[792],a[793],a[794],a[795],a[796]],[a[784],a[797],a[798],a[799],a[800],a[801],a[802],a[803],a[804],a[805],a[806],a[807],a[808]],[a[809],a[810]],[a[811],a[812]],[a[813],a[814],a[815],a[816],a[817],a[818],a[819],a[820],a[821],a[822],a[823],a[824],a[825]],[a[826],a[827],a[828],a[829],a[817],a[830],a[831],a[832],a[833],a[834],a[835],a[836],a[837]],[a[838],a[839]],[a[840],a[841]],[a[842],a[843],a[844],a[845],a[846],a[847],a[848],a[849],a[675],a[676],a[88],a[850]],[a[851],a[852],a[844],a[853],a[846],a[847],a[854],a[849],a[855],a[856],a[857],a[858]],[a[859],a[860],a[102],a[861],a[862],a[863],a[864]],[a[865],a[698],a[80],a[866],a[867],a[868],a[869]],[a[870],a[871],a[872],a[873],a[874],a[875],a[876]],[a[877],a[878]],[a[877],a[878],a[879],a[880]],[a[881],a[882]],[a[418],a[419],a[783],a[418],a[74],a[73],a[73],a[76],a[883],a[74],a[418],a[73],a[670],a[73]],[a[884],a[885],a[886],a[887],a[888],a[889],a[890],a[891],a[892],a[893],a[894],a[895],a[896],a[897]],[a[898],a[899],a[136],a[900],a[901],a[139],a[140],a[902],a[142],a[143],a[903],a[904],a[905],a[147]],[a[906]],[a[907],a[908],a[70],a[909],a[74],a[604],a[909],a[783],a[72],a[910],a[72],a[910]],[a[911],a[912],a[913],a[914],a[915],a[916],a[917],a[918],a[919],a[920],a[921],a[922]],[a[923],a[924],a[925],a[926],a[927],a[928],a[929],a[930],a[931],a[932],a[921],a[933]],[a[934],a[935],a[936],a[937],a[938],a[939],a[940],a[941],a[942],a[943],a[944],a[945]],[a[946],a[947],a[948],a[949],a[950],a[951],a[952],a[953],a[954],a[955],a[956],a[957]],[a[958],a[959]],{"ARS":a[960],"AUD":a[961],"BEF":a[962],"BMD":a[963],"BND":a[964],"BRL":a[454],"BSD":a[965],"BZD":a[966],"CAD":a[967],"CLP":a[968],"CNY":a[969],"COP":a[970],"CVE":a[971],"CYP":a[972],"EGP":a[973],"EUR":a[458],"FJD":a[974],"FKP":a[975],"FRF":a[71],"GBP":a[976],"GIP":a[977],"HKD":a[978],"IEP":a[979],"ILP":a[980],"ILS":a[461],"INR":a[462],"ITL":a[981],"JPY":a[982],"KRW":a[464],"LBP":a[983],"LRD":a[984],"MTP":a[985],"MXN":a[986],"NAD":a[987],"NZD":a[988],"RHD":a[989],"SBD":a[990],"SDG":a[991],"SGD":a[992],"SHP":a[993],"SRD":a[994],"SSP":a[995],"THB":a[467],"TTD":a[996],"TWD":a[997],"USD":a[998],"UYU":a[999],"VND":a[470],"WST":a[1000],"XAF":a[471],"XCD":a[472],"XOF":a[473],"XPF":a[1001]},{"weekday":a[13],"day":a[14],"month":a[13],"year":a[14],"hour":a[15],"minute":a[15],"second":a[15],"pattern":a[754],"pattern12":a[755]},[a[1002]],[a[1003],a[71],a[72],a[73],a[72],a[1003],a[1004],a[73],a[74],a[75],a[76],a[77]],[a[1005],a[1006],a[1007],a[1008],a[1009],a[1010],a[1011],a[1012],a[1013],a[1014],a[1015],a[1016]],[a[1017],a[1018],a[680],a[1019],a[1020],a[1021],a[1022],a[685],a[1023],a[1024],a[857],a[1025]],[a[1026],a[1027],a[1007],a[1028],a[1029],a[1030],a[1031]],[a[1032],a[1033],a[1034],a[1035],a[1036],a[1037],a[1038]],[a[1039],a[1040],a[607],a[608]],[a[746],a[747],a[607],a[608]],[a[1041],a[440]],{"AUD":a[621],"BRL":a[454],"CAD":a[455],"CNY":a[456],"EUR":a[458],"GBP":a[459],"HKD":a[460],"ILS":a[461],"INR":a[462],"JPY":a[463],"KRW":a[464],"MXN":a[465],"NZD":a[466],"THB":a[467],"TWD":a[468],"USD":a[617],"VND":a[470],"XAF":a[471],"XCD":a[472],"XOF":a[473],"XPF":a[474]},{"year":a[14],"month":a[13],"day":a[14],"weekday":a[13],"hour":a[14],"minute":a[15],"second":a[15],"pattern":a[1042],"pattern12":a[1043]},{"year":a[14],"month":a[13],"day":a[14],"weekday":a[13],"pattern":a[1044]},{"year":a[14],"month":a[13],"day":a[14],"pattern":a[1045]},{"year":a[14],"month":a[14],"day":a[14],"pattern":a[660]},{"year":a[14],"month":a[14],"pattern":a[1046]},{"year":a[14],"month":a[13],"pattern":a[1047]},{"month":a[13],"day":a[14],"pattern":a[1048]},{"hour":a[14],"minute":a[15],"second":a[15],"pattern":a[481],"pattern12":a[1049]},{"hour":a[14],"minute":a[15],"pattern":a[483],"pattern12":a[1050]},[a[1051]],[a[1052],a[1053],a[1054],a[1055],a[1056],a[1057],a[1058],a[1059],a[1060],a[1061],a[1062],a[1063]],[a[1064],a[1065],a[1066],a[1067],a[1068],a[1069],a[1070],a[1071],a[1072],a[1073],a[1074],a[1075]],[a[627],a[628],a[629],a[630],a[631],a[632],a[633],a[634],a[635],a[636],a[637],a[638],a[1076]],[a[1077],a[1078],a[1079],a[1080],a[1081],a[1082],a[1083],a[1084],a[1085],a[1086],a[1087],a[1088],a[1089]],[a[1090],a[1091],a[1092],a[1093],a[1094],a[1095],a[1096],a[1097],a[1098],a[1099],a[1100],a[1101],a[1102]],[a[1103],a[1104],a[1105],a[1106],a[1107],a[1108],a[1109],a[1110],a[1111],a[1112],a[1113],a[1114]],[a[1115],a[1116],a[1117],a[1118],a[1119],a[1120],a[1121]],[a[1122],a[1123],a[1124],a[1125],a[1126],a[1127],a[1128]],[a[1129],a[1130],a[1131]],{"am":a[1132],"pm":a[1133]},[a[627],a[628],a[629],a[630],a[631],a[632],a[633],a[634],a[635],a[636],a[637],a[638],a[1076],a[633]],[a[1134],a[1135],a[1136],a[1137],a[1138],a[1139],a[1140],a[1141],a[1142],a[1143],a[1144],a[1145],a[1146],a[1147]],[a[1148],a[1149],a[1150],a[1151],a[1152],a[1153],a[1154],a[1155],a[1156],a[1157],a[1158],a[1159]],[a[1160]],[a[1161],a[1162],a[1163],a[1164],a[1165],a[1166],a[1167],a[1168],a[1169],a[1170],a[1171],a[1172]],[a[1173],a[1174],a[1175],a[1176],a[1177],a[1178],a[1179],a[1180],a[1181],a[1182],a[1183],a[1184],a[1185],a[1186],a[1187],a[1188],a[1189],a[1190],a[1191],a[1192],a[1193],a[1194],a[1195],a[1196],a[1197],a[1198],a[1199],a[1200],a[1201],a[1202],a[1203],a[1204],a[1205],a[1206],a[1207],a[1208],a[1209],a[1210],a[1211],a[1212],a[1213],a[1214],a[1215],a[1216],a[1217],a[1218],a[1219],a[1220],a[1221],a[1222],a[1223],a[1224],a[1225],a[1226],a[1227],a[1228],a[1229],a[1230],a[1231],a[1232],a[1233],a[1234],a[1235],a[1236],a[1237],a[1238],a[1239],a[1240],a[1241],a[1242],a[1243],a[1244],a[1245],a[1246],a[1247],a[1248],a[1249],a[1250],a[1251],a[1252],a[1253],a[1254],a[1255],a[1256],a[1257],a[1258],a[1259],a[1260],a[1261],a[1262],a[1263],a[1264],a[1265],a[1266],a[1267],a[1268],a[1269],a[1270],a[1271],a[1272],a[1273],a[1274],a[1275],a[1276],a[1277],a[1278],a[1279],a[1280],a[1281],a[1282],a[1283],a[1284],a[1285],a[1286],a[1287],a[1288],a[1289],a[1290],a[1291],a[1292],a[1293],a[1294],a[1295],a[1296],a[1297],a[1298],a[1299],a[1300],a[1301],a[1302],a[1303],a[1304],a[1305],a[1306],a[1307],a[1308],a[1309],a[1310],a[1311],a[1312],a[1313],a[1314],a[1315],a[1316],a[1317],a[1318],a[1319],a[1320],a[1321],a[1322],a[1323],a[1324],a[1325],a[1326],a[1327],a[1328],a[1329],a[1330],a[1331],a[1332],a[1333],a[1334],a[1335],a[1336],a[1337],a[1338],a[1339],a[1340],a[1341],a[1342],a[1343],a[1344],a[1345],a[1346],a[1347],a[1348],a[1349],a[1350],a[1351],a[1352],a[1353],a[1354],a[1355],a[1356],a[1357],a[1358],a[1359],a[1360],a[1361],a[1362],a[1363],a[1364],a[1365],a[1366],a[1367],a[1368],a[1369],a[1370],a[1371],a[1372],a[1373],a[1374],a[1375],a[1376],a[1377],a[1378],a[1379],a[1380],a[1381],a[1382],a[1383],a[1384],a[1385],a[1386],a[1387],a[1388],a[1389],a[1390],a[1391],a[1392],a[1393],a[1394],a[1395],a[1396],a[1397],a[1398],a[1399],a[1400],a[1401],a[1402],a[1403],a[1404],a[72],a[418],a[74],a[419]],[a[1173],a[1174],a[1175],a[1176],a[1177],a[1178],a[1179],a[1180],a[1181],a[1182],a[1183],a[1184],a[1185],a[1186],a[1187],a[1188],a[1189],a[1190],a[1191],a[1192],a[1193],a[1194],a[1195],a[1196],a[1197],a[1198],a[1199],a[1200],a[1201],a[1202],a[1203],a[1204],a[1205],a[1206],a[1207],a[1208],a[1209],a[1210],a[1211],a[1212],a[1213],a[1214],a[1215],a[1216],a[1217],a[1218],a[1219],a[1220],a[1221],a[1222],a[1223],a[1224],a[1225],a[1226],a[1227],a[1228],a[1229],a[1230],a[1231],a[1232],a[1233],a[1234],a[1235],a[1236],a[1237],a[1238],a[1239],a[1240],a[1241],a[1242],a[1243],a[1244],a[1245],a[1246],a[1247],a[1248],a[1249],a[1250],a[1251],a[1252],a[1253],a[1254],a[1255],a[1256],a[1257],a[1258],a[1259],a[1260],a[1261],a[1262],a[1263],a[1264],a[1265],a[1266],a[1267],a[1268],a[1269],a[1270],a[1271],a[1272],a[1273],a[1274],a[1275],a[1276],a[1277],a[1278],a[1279],a[1280],a[1281],a[1282],a[1283],a[1284],a[1285],a[1286],a[1287],a[1288],a[1289],a[1290],a[1291],a[1292],a[1293],a[1294],a[1295],a[1296],a[1297],a[1298],a[1299],a[1300],a[1301],a[1302],a[1303],a[1304],a[1305],a[1306],a[1307],a[1308],a[1309],a[1310],a[1311],a[1312],a[1313],a[1314],a[1315],a[1316],a[1317],a[1318],a[1319],a[1320],a[1321],a[1322],a[1323],a[1324],a[1325],a[1326],a[1327],a[1328],a[1329],a[1330],a[1331],a[1332],a[1333],a[1334],a[1335],a[1336],a[1337],a[1338],a[1339],a[1340],a[1341],a[1342],a[1343],a[1344],a[1345],a[1346],a[1347],a[1348],a[1349],a[1350],a[1351],a[1352],a[1353],a[1354],a[1355],a[1356],a[1357],a[1358],a[1359],a[1360],a[1361],a[1362],a[1363],a[1364],a[1365],a[1366],a[1367],a[1368],a[1369],a[1370],a[1371],a[1372],a[1373],a[1374],a[1375],a[1376],a[1377],a[1378],a[1379],a[1380],a[1381],a[1382],a[1383],a[1384],a[1385],a[1386],a[1387],a[1388],a[1389],a[1390],a[1391],a[1392],a[1393],a[1394],a[1395],a[1396],a[1397],a[1398],a[1399],a[1400],a[1401],a[1402],a[1403],a[1404],a[1405],a[1406],a[1407],a[1408]],[a[1409],a[1410],a[1411],a[1412],a[1413],a[1414],a[1415],a[1416],a[1417],a[1418],a[1419],a[1420]],[a[1421],a[1422]],{"AUD":a[453],"BRL":a[454],"CAD":a[455],"CNY":a[1423],"EUR":a[458],"GBP":a[459],"HKD":a[460],"ILS":a[461],"INR":a[462],"JPY":a[1424],"KRW":a[1425],"MXN":a[465],"NZD":a[466],"THB":a[467],"TWD":a[468],"USD":a[469],"VND":a[470],"XAF":a[471],"XCD":a[472],"XOF":a[473],"XPF":a[474]},{"year":a[14],"month":a[13],"day":a[14],"weekday":a[13],"hour":a[14],"minute":a[15],"second":a[15],"pattern":a[1426],"pattern12":a[1427]},{"year":a[14],"month":a[13],"day":a[14],"weekday":a[13],"pattern":a[1428]},{"year":a[14],"month":a[13],"day":a[14],"pattern":a[1429]},{"year":a[14],"month":a[14],"day":a[14],"pattern":a[1430]},{"year":a[14],"month":a[14],"pattern":a[1431]},{"year":a[14],"month":a[13],"pattern":a[1432]},{"month":a[14],"day":a[14],"pattern":a[1433]},{"hour":a[14],"minute":a[15],"second":a[15],"pattern":a[481],"pattern12":a[1434]},{"hour":a[14],"minute":a[15],"pattern":a[483],"pattern12":a[1435]},[a[1436]],[a[1437],a[1438],a[1439],a[1440],a[1441],a[1442],a[1443],a[1444],a[1445],a[1446],a[1447],a[1448],a[1449]],[a[1450],a[1451],a[1452],a[1453],a[1454],a[1455],a[1456],a[1457],a[1458],a[1459],a[1460],a[1461]],[a[1462],a[1463],a[1464],a[1465],a[1466],a[1467],a[1468],a[1469],a[1470],a[1471],a[1472],a[1473],a[1474]],[a[1475],a[1476],a[1477],a[1478],a[1479],a[1480],a[1481]],[a[1482],a[1483],a[1484],a[1485],a[1486],a[1487],a[1488]],[a[1489],a[1490]],[a[1491],a[1492]],{"am":a[1493],"pm":a[1494]},[a[1495],a[1496],a[1497],a[1498],a[1499],a[1500],a[1501],a[1502],a[1503],a[1504],a[1505],a[1506],a[1507],a[1508]],[a[1509],a[1510],a[1511],a[1512],a[1513],a[1514],a[1515],a[1516],a[1517],a[1518],a[1519],a[1520],a[1521],a[1522],a[1523],a[1524],a[1525],a[1526],a[1527],a[1528],a[1529],a[1530],a[1531],a[1532],a[1533],a[1534],a[1535],a[1536],a[1537],a[1538],a[1539],a[1540],a[1541],a[1542],a[1543],a[1544],a[1545],a[1546],a[1547],a[1548],a[1549],a[1550],a[1551],a[1552],a[1553],a[1554],a[1555],a[1556],a[1557],a[1558],a[1559],a[1560],a[1561],a[1562],a[1563],a[1564],a[1565],a[1566],a[1567],a[1568],a[1569],a[1570],a[1571],a[1572],a[1573],a[1574],a[1575],a[1576],a[1577],a[1578],a[1579],a[1580],a[1581],a[1582],a[1583],a[1584],a[1585],a[1586],a[1587],a[1588],a[1589],a[1590],a[1591],a[1592],a[1593],a[1594],a[1595],a[1596],a[1597],a[1598],a[1599],a[1600],a[1601],a[1602],a[1603],a[1604],a[1605],a[1606],a[1607],a[1608],a[1609],a[1610],a[1611],a[1612],a[1613],a[1614],a[1615],a[1616],a[1617],a[1618],a[1619],a[1620],a[1621],a[1622],a[1623],a[1624],a[1625],a[1626],a[1627],a[1628],a[1629],a[1630],a[1631],a[1632],a[1633],a[1634],a[1635],a[1636],a[1637],a[1638],a[1639],a[1640],a[1641],a[1642],a[1643],a[1644],a[1645],a[1646],a[1647],a[1648],a[1649],a[1650],a[1651],a[1652],a[1653],a[1654],a[1655],a[1656],a[1657],a[1658],a[1659],a[1660],a[1661],a[1662],a[1663],a[1664],a[1665],a[1666],a[1667],a[1668],a[1669],a[1670],a[1671],a[1672],a[1673],a[1674],a[1675],a[1676],a[1677],a[1678],a[1679],a[1680],a[1681],a[1682],a[1683],a[1684],a[1685],a[1686],a[1687],a[1688],a[1689],a[1690],a[1691],a[1692],a[1693],a[1694],a[1695],a[1696],a[1697],a[1698],a[1699],a[1700],a[1701],a[1702],a[1703],a[1704],a[1705],a[1706],a[1707],a[1708],a[1709],a[1710],a[1711],a[1712],a[1713],a[1714],a[1715],a[1716],a[1717],a[1718],a[1719],a[1720],a[1721],a[1722],a[1723],a[1724],a[1725],a[1726],a[1727],a[1728],a[1729],a[1730],a[1731],a[1732],a[1733],a[1734],a[1735],a[1736],a[1737],a[1738],a[1739],a[1740],a[1741],a[1742],a[1743],a[1744]],[a[1745],a[1746]],{"positivePattern":a[613],"negativePattern":a[1747]},{"AUD":a[453],"BRL":a[454],"CAD":a[455],"CNY":a[456],"EUR":a[458],"GBP":a[459],"HKD":a[460],"ILS":a[461],"INR":a[462],"JPY":a[463],"KRW":a[464],"MXN":a[465],"NZD":a[466],"THB":a[467],"TWD":a[468],"USD":a[617],"VND":a[470],"XAF":a[471],"XCD":a[472],"XOF":a[473],"XPF":a[474]},{"day":a[14],"month":a[14],"year":a[14],"pattern":a[723]},{"day":a[14],"month":a[14],"pattern":a[724]},[a[1748],a[1749],a[1750],a[1751],a[1752],a[47],a[48],a[1753],a[50],a[1754],a[1755],a[1756],a[1757]],[a[1758],a[1759],a[59],a[60],a[1760],a[1761],a[1762],a[1763],a[65],a[1764],a[67],a[1765],a[1766]],[a[78],a[79],a[1767],a[81],a[1768],a[83],a[84],a[85],a[86],a[87],a[88],a[89]],[a[1769],a[1770],a[1771],a[93],a[1768],a[94],a[95],a[1772],a[97],a[98],a[99],a[100]],[a[1773],a[102],a[859],a[1774],a[1775],a[1776],a[1777]],[a[1778],a[1779],a[1780],a[1781],a[1782],a[1783],a[1784]],[a[1785],a[1786],a[1787],a[1788]],[a[1789],a[1790],a[1791],a[1792]],[a[1793],a[1794],a[1795],a[1796]],[a[1797],a[1798],a[136],a[137],a[1799],a[1800],a[140],a[141],a[1801],a[143],a[1802],a[145],a[1803],a[1804]],[a[148],a[1805],a[1806],a[1807],a[1808],a[1809],a[1810],a[1811],a[156],a[1812],a[1813],a[1814]],[a[1815],a[162],a[163],a[164],a[1816],a[1817],a[167],a[1818],a[169],a[1819],a[1820],a[1821]],[a[1822],a[174],a[1823],a[1824],a[1825],a[1826],a[179],a[1827],a[181],a[1828],a[1829],a[1830]],[a[1831]],{"positivePattern":a[529],"negativePattern":a[1832]},{"AUD":a[453],"BRL":a[454],"CAD":a[1833],"CNY":a[456],"EUR":a[458],"FJD":a[1834],"GBP":a[459],"HKD":a[460],"ILS":a[461],"INR":a[462],"JPY":a[463],"KRW":a[464],"MXN":a[465],"NZD":a[466],"SBD":a[1835],"THB":a[467],"TWD":a[468],"USD":a[617],"VND":a[470],"XAF":a[471],"XCD":a[472],"XOF":a[473]},[a[1836],a[1837],a[1838],a[1839],a[1840],a[1841],a[1842],a[1843],a[1844],a[1845],a[1846],a[1847]],[a[1848],a[1849],a[1007],a[1850],a[846],a[1851],a[1852],a[1012],a[1013],a[1853],a[1015],a[1854]],[a[1855],a[1856],a[1857],a[681],a[1858],a[1859],a[1860],a[685],a[1861],a[1862],a[1863],a[1864]],[a[1026],a[1865],a[817],a[1866],a[1867],a[1868],a[745]],[a[703],a[1869],a[1870],a[1871],a[1872],a[1873],a[709]],[a[746],a[747]],[a[1874],a[1875]],[a[1876],a[719]],{"AUD":a[453],"BRL":a[454],"CAD":a[455],"CNY":a[456],"EUR":a[458],"GBP":a[459],"HKD":a[460],"ILS":a[461],"INR":a[462],"JPY":a[463],"KRW":a[464],"MXN":a[465],"NZD":a[466],"PTE":a[1877],"THB":a[467],"TWD":a[468],"USD":a[617],"VND":a[470],"XAF":a[471],"XCD":a[472],"XOF":a[473],"XPF":a[474]},[a[784],a[797],a[798],a[1878],a[800],a[801],a[802],a[803],a[804],a[805],a[806],a[807],a[808]],{},[a[1848],a[1006],a[1007],a[1008],a[82],a[1851],a[1852],a[1879],a[1880],a[1881],a[1015],a[1882]],[a[1769],a[1770],a[844],a[93],a[82],a[94],a[95],a[1883],a[97],a[98],a[99],a[100]],[a[1884],a[1885],a[103],a[104],a[105],a[106],a[1886]],[a[1887],a[1888],a[1889],a[1890],a[1891],a[1892],a[1893]],[a[1894],a[1895],a[1896],a[118],a[119],a[120],a[1897]],[a[126],a[127],a[124],a[125]],[a[1898],a[1899],a[1900],a[1901]],{"am":a[1902],"pm":a[1903]},[a[1904],a[1905],a[1906],a[1907],a[1908],a[1909],a[1910],a[1911],a[1912],a[1913],a[1914],a[895],a[1915]],[a[1904],a[1905],a[1906],a[1907],a[1908],a[1909],a[1910],a[1911],a[1912],a[1913],a[1914],a[895],a[1915],a[1916]],[a[1917]],[a[1918],a[947],a[1919],a[1920],a[1921],a[1922],a[952],a[1923],a[954],a[1924],a[1925],a[1926]],[a[1927],a[1928],a[1929],a[1930],a[1931],a[1932],a[1933],a[1934],a[1935],a[1936],a[1937],a[1938],a[1939],a[1940],a[1941],a[1942],a[1943],a[1944],a[1945],a[1946],a[1947],a[1948],a[1949],a[1950],a[1951],a[1952],a[1953],a[1954],a[1955],a[1956],a[1957],a[1958],a[1959],a[1960],a[1961],a[1962],a[1963],a[1964],a[1965],a[1966],a[1967],a[1968],a[1969],a[1970],a[1971],a[1972],a[1973],a[1974],a[1975],a[1976],a[1977],a[1978],a[1979],a[1980],a[1981],a[1982],a[1983],a[1984],a[1985],a[1986],a[1987],a[1988],a[1989],a[1990],a[1991],a[1992],a[1993],a[1994],a[1995],a[1996],a[1997],a[1998],a[1999],a[2000],a[2001],a[2002],a[2003],a[2004],a[2005],a[2006],a[2007],a[2008],a[2009],a[2010],a[2011],a[2012],a[2013],a[2014],a[2015],a[2016],a[2017],a[2018],a[2019],a[2020],a[2021],a[2022],a[2023],a[2024],a[2025],a[2026],a[2027],a[2028],a[2029],a[2030],a[2031],a[2032],a[2033],a[2034],a[2035],a[2036],a[2037],a[2038],a[2039],a[2040],a[2041],a[2042],a[2043],a[2044],a[2045],a[2046],a[2047],a[2048],a[2049],a[2050],a[2051],a[2052],a[2053],a[2054],a[2055],a[2056],a[2057],a[2058],a[2059],a[2060],a[2061],a[2062],a[2063],a[2064],a[2065],a[2066],a[2067],a[2068],a[2069],a[2070],a[2071],a[2072],a[2073],a[2074],a[2075],a[2076],a[2077],a[2078],a[2079],a[2080],a[2081],a[2082],a[2083],a[2084],a[2085],a[2086],a[2087],a[2088],a[2089],a[2090],a[2091],a[2092],a[2093],a[2094],a[2095],a[2096],a[2097],a[2098],a[2099],a[2100],a[2101],a[2102],a[2103],a[2104],a[2105],a[2106],a[2107],a[2108],a[2109],a[2110],a[2111],a[2112],a[2113],a[2114],a[2115],a[2116],a[2117],a[2118],a[2119],a[2120],a[2121],a[2122],a[2123],a[2124],a[2125],a[2126],a[2127],a[2128],a[2129],a[2130],a[2131],a[2132],a[2133],a[2134],a[2135],a[2136],a[2137],a[2138],a[2139],a[2140],a[2141],a[2142],a[2143],a[2144],a[2145],a[2146],a[2147],a[2148],a[2149],a[2150],a[2151],a[2152],a[2153],a[2154],a[2155],a[2156],a[2157],a[2158],a[422],a[423],a[424],a[425]],[a[2159],a[2160],a[2161],a[2162],a[2163],a[2164],a[2165],a[2166],a[2167],a[2168],a[2169],a[2170]],[a[2171],a[2172]],{"decimal":a[448],"group":a[661],"nan":a[2173],"percent":a[451],"infinity":a[452]},{"AUD":a[453],"BBD":a[2174],"BDT":a[2175],"BMD":a[2176],"BND":a[2177],"BRL":a[2178],"BSD":a[2179],"BZD":a[2180],"CAD":a[2181],"CNY":a[456],"DKK":a[2182],"DOP":a[2183],"EGP":a[2184],"EUR":a[458],"GBP":a[2185],"GYD":a[2186],"HKD":a[460],"ILS":a[461],"INR":a[462],"ISK":a[2187],"JMD":a[2188],"JPY":a[463],"KRW":a[464],"LVL":a[2189],"MXN":a[465],"NOK":a[2190],"NZD":a[466],"SEK":a[457],"SYP":a[2191],"THB":a[2192],"TWD":a[2193],"USD":a[617],"VND":a[2194],"XAF":a[471],"XCD":a[472],"XOF":a[473],"XPF":a[474]},{"day":a[14],"month":a[13],"year":a[14],"weekday":a[13],"hour":a[14],"minute":a[15],"second":a[15],"pattern":a[2195],"pattern12":a[2196]},{"day":a[14],"month":a[13],"year":a[14],"weekday":a[13],"pattern":a[2197]},{"day":a[15],"month":a[15],"year":a[14],"pattern":a[478]},[a[2198],a[2199],a[1750],a[2200],a[2201],a[2202],a[2203],a[2204],a[2205],a[2206],a[2207],a[2208],a[2209]],[a[57],a[2210],a[2211],a[60],a[429],a[2212],a[2213],a[1763],a[2214],a[66],a[67],a[2215],a[2216]],[a[75],a[2217],a[72],a[76],a[72],a[419],a[418],a[73],a[670],a[670],a[783],a[73]],[a[2218],a[2219],a[566],a[2220],a[568],a[2221],a[2222],a[2223],a[2224],a[2225],a[2226],a[2227]],[a[2228],a[2229],a[2230],a[141],a[2231],a[2232],a[2233],a[2234],a[2235],a[2236],a[2237],a[2238]],[a[2239],a[2240],a[589],a[2241],a[2242],a[2243],a[2244]],[a[2245],a[2246],a[2247],a[2248],a[2249],a[2250],a[2251]],[a[2252],a[2253],a[2254],a[2255],a[2256],a[2257],a[2258]],[a[2259],a[2260],a[2261],a[2262]],[a[2263],a[2264]],{"am":a[2265],"pm":a[2266]},[a[2267],a[2268],a[136],a[137],a[2269],a[2270],a[140],a[141],a[2271],a[143],a[144],a[145],a[146],a[147]],[a[2272],a[2273],a[2274],a[2275],a[2276],a[2277],a[2278],a[2279],a[2280],a[2281],a[2282],a[2283]],[a[2284]],[a[2285],a[2286],a[2287],a[429],a[430],a[2288],a[432],a[433],a[2289],a[435],a[2290],a[2291]],{"positivePattern":a[2292],"negativePattern":a[2293]},{"AUD":a[453],"BRL":a[454],"CAD":a[455],"CNY":a[456],"EUR":a[458],"GBP":a[459],"HKD":a[460],"ILS":a[461],"INR":a[462],"JPY":a[533],"KRW":a[464],"MXN":a[465],"NZD":a[466],"THB":a[467],"TRY":a[2294],"TWD":a[468],"USD":a[469],"VND":a[470],"XAF":a[471],"XCD":a[472],"XOF":a[473],"XPF":a[474]},{"year":a[14],"month":a[13],"day":a[14],"weekday":a[13],"hour":a[14],"minute":a[15],"second":a[15],"pattern":a[2295],"pattern12":a[2296]},{"year":a[14],"month":a[13],"day":a[14],"weekday":a[13],"pattern":a[2297]},[a[2298]],[a[1103],a[1104],a[1105],a[1106],a[1107],a[1108],a[1109],a[1110],a[1111],a[1112],a[1113],a[1114],a[2299]],[a[2300],a[1065],a[1066],a[1067],a[1068],a[1069],a[1070],a[1071],a[1072],a[1073],a[1074],a[1075],a[2301]],[a[2300],a[1065],a[1066],a[1067],a[1068],a[1069],a[1070],a[1071],a[1072],a[1073],a[1074],a[1075]],[a[2302],a[2303],a[2304],a[2305],a[2306],a[2307],a[2308]],[a[2309],a[2310],a[2311],a[2312],a[2313],a[2314],a[2315]],[a[2316],a[2317]],{"am":a[2318],"pm":a[2319]},[a[1103],a[1104],a[1105],a[1106],a[1107],a[1108],a[1109],a[1110],a[1111],a[1112],a[1113],a[1114],a[2299],a[2320]],[a[2300],a[1065],a[1066],a[1067],a[1068],a[1069],a[1070],a[1071],a[1072],a[1073],a[1074],a[1075],a[2301],a[2321]],[a[2322]],[a[2323]],[a[2324]],[a[2325],a[2326],a[2327],a[2328],a[2329],a[2330],a[2331],a[2332],a[2333],a[2334],a[2335],a[2336],a[2337],a[2338],a[2339],a[2340],a[2341],a[2342],a[2343],a[2344],a[2345],a[2346],a[2347],a[2348],a[2349],a[2350],a[2351],a[2352],a[2353],a[2354],a[2355],a[2356],a[2357],a[2358],a[2359],a[2360],a[2361],a[2362],a[2363],a[2364],a[2365],a[2366],a[2367],a[2368],a[2369],a[2370],a[2371],a[2372],a[2373],a[2374],a[2375],a[2376],a[2377],a[2378],a[2379],a[2380],a[2381],a[2382],a[2383],a[2384],a[2385],a[2386],a[2387],a[2388],a[2389],a[2390],a[2391],a[2392],a[2393],a[2394],a[2395],a[2396],a[2397],a[2398],a[2399],a[2400],a[2401],a[2402],a[2403],a[2404],a[2405],a[2406],a[2407],a[2408],a[2409],a[2410],a[2411],a[2412],a[2413],a[2414],a[2415],a[2416],a[2417],a[2418],a[2419],a[2420],a[2421],a[2422],a[2423],a[2424],a[2425],a[2426],a[2427],a[2428],a[2429],a[2430],a[2431],a[2432],a[2433],a[2434],a[2435],a[2436],a[2437],a[2438],a[2439],a[2440],a[2441],a[2442],a[2443],a[2444],a[2445],a[2446],a[2447],a[2448],a[2449],a[2450],a[2451],a[2452],a[2453],a[2454],a[2455],a[2456],a[2457],a[2458],a[2459],a[2460],a[2461],a[2462],a[2463],a[2464],a[2465],a[2466],a[2467],a[2468],a[2469],a[2470],a[2471],a[2472],a[2473],a[2474],a[2475],a[2476],a[2477],a[2478],a[2479],a[2480],a[2481],a[2482],a[2483],a[2484],a[2485],a[2486],a[2487],a[2488],a[2489],a[2490],a[2491],a[2492],a[2493],a[2494],a[2495],a[2496],a[2497],a[2498],a[2499],a[2500],a[2501],a[2502],a[2503],a[2504],a[2505],a[2506],a[2507],a[2508],a[2509],a[2510],a[2511],a[2512],a[2513],a[2514],a[2515],a[2516],a[2517],a[2518],a[2519],a[2520],a[2521],a[2522],a[2523],a[2524],a[2525],a[2526],a[2527],a[2528],a[2529],a[2530],a[2531],a[2532],a[2533],a[2534],a[2535],a[2536],a[2537],a[2538],a[2539],a[2540],a[2541],a[2542],a[2543],a[2544],a[2545],a[2546],a[2547],a[2548],a[2549],a[2550],a[2551],a[2552],a[2553],a[2554],a[2555],a[2556],a[1405],a[1406],a[1407],a[1408]],[a[2557]],{"AUD":a[453],"BRL":a[454],"CAD":a[455],"CNY":a[1424],"EUR":a[458],"GBP":a[459],"HKD":a[460],"ILS":a[461],"INR":a[462],"JPY":a[463],"KRW":a[1425],"MXN":a[465],"NZD":a[466],"THB":a[467],"TWD":a[468],"USD":a[617],"VND":a[470],"XAF":a[471],"XCD":a[472],"XOF":a[473],"XPF":a[474]}];b[1]=[[b[0][1],b[0][2],b[0][3],b[0][4],b[0][5],b[0][6],b[0][7],b[0][8],b[0][9],b[0][10]],{"short":b[0][11]},{"long":b[0][12]},{"long":b[0][13]},{"short":b[0][14]},{"long":b[0][15]},{"short":b[0][16]},{"narrow":b[0][17],"short":b[0][18],"long":b[0][19]},{"narrow":b[0][20],"short":b[0][21],"long":b[0][22]},{"narrow":b[0][23],"short":b[0][24],"long":b[0][25]},{"long":b[0][27]},{"short":b[0][28]},{"long":b[0][29]},{"short":b[0][30]},{"short":b[0][31],"long":b[0][32]},{"short":b[0][33]},{"narrow":b[0][34],"short":b[0][35]},{"long":b[0][36]},{"short":b[0][37]},{"short":b[0][38]},{"decimal":b[0][40],"currency":b[0][41],"percent":b[0][42]},{"latn":b[0][43]},[b[0][45],b[0][46],b[0][3],b[0][47],b[0][48],b[0][6],b[0][7],b[0][49],b[0][50],b[0][51]],{"narrow":b[0][17],"short":b[0][52],"long":b[0][53]},{"narrow":b[0][54],"short":b[0][54],"long":b[0][55]},{"narrow":b[0][56],"short":b[0][57],"long":b[0][58]},{"decimal":b[0][40],"currency":b[0][60],"percent":b[0][42]},{"latn":b[0][61]},[b[0][63],b[0][64],b[0][65],b[0][4],b[0][5],b[0][6],b[0][66],b[0][67],b[0][50],b[0][51]],{"short":b[0][68],"long":b[0][69]},{"short":b[0][70],"long":b[0][71]},{"narrow":b[0][72],"short":b[0][73],"long":b[0][74]},{"narrow":b[0][75],"short":b[0][76],"long":b[0][77]},{"decimal":b[0][40],"currency":b[0][78],"percent":b[0][79]},{"latn":b[0][80]},[b[0][63],b[0][64],b[0][65],b[0][82],b[0][83],b[0][6],b[0][66],b[0][84],b[0][50],b[0][51]],[b[0][86],b[0][87],b[0][88],b[0][89],b[0][90],b[0][6],b[0][91],b[0][92],b[0][50],b[0][51]],{"narrow":b[0][93],"short":b[0][93],"long":b[0][93]},{"narrow":b[0][93],"short":b[0][29],"long":b[0][29]},{"short":b[0][95]},{"narrow":b[0][93],"short":b[0][31],"long":b[0][32]},[b[0][97],b[0][98],b[0][99],b[0][4],b[0][5],b[0][6],b[0][66],b[0][67],b[0][50],b[0][51]],{"narrow":b[0][34],"short":b[0][100]},[b[0][102],b[0][103],b[0][65],b[0][4],b[0][5],b[0][6],b[0][66],b[0][8],b[0][50],b[0][51]],[b[0][106],b[0][107],b[0][65],b[0][4],b[0][5],b[0][6],b[0][66],b[0][67],b[0][50],b[0][51]],{"decimal":b[0][40],"currency":b[0][108],"percent":b[0][79],"secondaryGroupSize":2},[b[0][63],b[0][64],b[0][65],b[0][110],b[0][5],b[0][6],b[0][66],b[0][8],b[0][50],b[0][51]],[b[0][63],b[0][64],b[0][65],b[0][112],b[0][5],b[0][6],b[0][66],b[0][67],b[0][50],b[0][51]],[b[0][114],b[0][115],b[0][116],b[0][117],b[0][5],b[0][6],b[0][118],b[0][119],b[0][50],b[0][51]],{"latn":b[0][120]},[b[0][122],b[0][123],b[0][124],b[0][4],b[0][125],b[0][126],b[0][127],b[0][8],b[0][50],b[0][51]],{"narrow":b[0][128],"short":b[0][129],"long":b[0][130]},{"narrow":b[0][131],"short":b[0][132],"long":b[0][133]},{"short":b[0][134],"long":b[0][135]},{"short":b[0][137]},{"decimal":b[0][40],"currency":b[0][138],"percent":b[0][79]},[b[0][122],b[0][123],b[0][124],b[0][140],b[0][141],b[0][126],b[0][127],b[0][142],b[0][50],b[0][51]],{"decimal":b[0][40],"currency":b[0][143],"percent":b[0][79]},[b[0][122],b[0][123],b[0][124],b[0][4],b[0][5],b[0][126],b[0][127],b[0][8],b[0][50],b[0][51]],{"decimal":b[0][40],"currency":b[0][41],"percent":b[0][79]},[b[0][147],b[0][123],b[0][124],b[0][4],b[0][5],b[0][126],b[0][127],b[0][8],b[0][148],b[0][149]],{"narrow":b[0][150],"short":b[0][151],"long":b[0][130]},{"narrow":b[0][152],"short":b[0][153],"long":b[0][133]},{"short":b[0][154],"long":b[0][135]},{"decimal":b[0][40],"currency":b[0][108],"percent":b[0][79]},[b[0][159],b[0][103],b[0][88],b[0][4],b[0][5],b[0][6],b[0][91],b[0][8],b[0][50],b[0][51]],{"narrow":b[0][160],"short":b[0][161],"long":b[0][162]},{"narrow":b[0][93],"short":b[0][163],"long":b[0][164]},{"narrow":b[0][165],"short":b[0][166],"long":b[0][167]},{"short":b[0][168],"long":b[0][169]},{"short":b[0][170],"long":b[0][171]},{"short":b[0][172],"long":b[0][173]},{"narrow":b[0][17],"short":b[0][174],"long":b[0][175]},{"narrow":b[0][176],"short":b[0][177],"long":b[0][178]},{"narrow":b[0][179],"short":b[0][180],"long":b[0][181]},{"narrow":b[0][182],"short":b[0][183],"long":b[0][184]},{"short":b[0][28],"long":b[0][185]},{"narrow":b[0][186],"short":b[0][187],"long":b[0][188]},{"narrow":b[0][93],"short":b[0][189],"long":b[0][190]},{"short":b[0][191]},[b[0][193],b[0][103],b[0][88],b[0][4],b[0][5],b[0][6],b[0][91],b[0][8],b[0][148],b[0][149]],{"short":b[0][194]},{"narrow":b[0][195],"short":b[0][196],"long":b[0][197]},{"narrow":b[0][198],"short":b[0][198],"long":b[0][199]},{"narrow":b[0][200],"short":b[0][200],"long":b[0][201]},{"short":b[0][202]},[b[0][204],b[0][205],b[0][206],b[0][207],b[0][208],b[0][209],b[0][210],b[0][67],b[0][211],b[0][212]],{"short":b[0][11],"long":b[0][213]},{"narrow":b[0][214],"short":b[0][215],"long":b[0][215]},{"narrow":b[0][216],"short":b[0][217],"long":b[0][217]},{"narrow":b[0][216],"short":b[0][218],"long":b[0][218]},{"narrow":b[0][93],"short":b[0][219],"long":b[0][219]},{"narrow":b[0][220],"short":b[0][220],"long":b[0][221]},{"narrow":b[0][76],"short":b[0][222],"long":b[0][222]},{"narrow":b[0][224],"short":b[0][225],"long":b[0][225]},{"narrow":b[0][93],"short":b[0][226],"long":b[0][226]},{"short":b[0][227]},{"narrow":b[0][93],"short":b[0][228],"long":b[0][228]},{"narrow":b[0][229],"short":b[0][230]},{"narrow":b[0][93],"short":b[0][231],"long":b[0][231]},{"short":b[0][232]},[b[0][234],b[0][235],b[0][236],b[0][237],b[0][238],b[0][239],b[0][66],b[0][240],b[0][241],b[0][242]],{"short":b[0][243]},{"short":b[0][244],"long":b[0][13]},{"narrow":b[0][93],"short":b[0][245],"long":b[0][245]},{"short":b[0][246],"long":b[0][15]},{"narrow":b[0][245],"short":b[0][245],"long":b[0][245]},{"narrow":b[0][247],"short":b[0][247],"long":b[0][248]},{"short":b[0][249],"long":b[0][250]},{"short":b[0][252],"long":b[0][27]},{"narrow":b[0][34],"short":b[0][253]},{"short":b[0][254]},{"decimal":b[0][40],"currency":b[0][255],"percent":b[0][79]},[b[0][159],b[0][103],b[0][88],b[0][257],b[0][125],b[0][6],b[0][91],b[0][258],b[0][50],b[0][51]],{"narrow":b[0][93],"long":b[0][12]},{"narrow":b[0][216],"short":b[0][259],"long":b[0][259]},{"narrow":b[0][93]},{"narrow":b[0][216],"short":b[0][260],"long":b[0][260]},{"narrow":b[0][17],"short":b[0][261],"long":b[0][262]},{"narrow":b[0][263],"short":b[0][263],"long":b[0][264]},{"narrow":b[0][265],"short":b[0][266],"long":b[0][267]},{"short":b[0][268],"long":b[0][268]},{"narrow":b[0][93],"short":b[0][269],"long":b[0][269]},{"narrow":b[0][93],"short":b[0][270],"long":b[0][271]},{"short":b[0][272]},{"narrow":b[0][93],"short":b[0][36],"long":b[0][36]},{"decimal":b[0][40],"currency":b[0][273],"percent":b[0][79]},[b[0][122],b[0][123],b[0][124],b[0][89],b[0][90],b[0][126],b[0][127],b[0][8],b[0][50],b[0][51]],{"narrow":b[0][93],"short":b[0][93],"long":b[0][275]},{"narrow":b[0][216],"short":b[0][13],"long":b[0][13]},{"narrow":b[0][216],"short":b[0][15],"long":b[0][15]},{"narrow":b[0][17],"short":b[0][276],"long":b[0][277]},{"narrow":b[0][278],"short":b[0][278],"long":b[0][279]},{"short":b[0][280],"long":b[0][281]},{"short":b[0][27],"long":b[0][27]},{"short":b[0][282]},[b[0][159],b[0][103],b[0][88],b[0][82],b[0][83],b[0][6],b[0][91],b[0][8],b[0][50],b[0][51]],{"short":b[0][284],"long":b[0][284]},{"short":b[0][171],"long":b[0][171]},{"narrow":b[0][17],"short":b[0][286],"long":b[0][287]},{"narrow":b[0][288],"short":b[0][289],"long":b[0][290]},{"narrow":b[0][291],"short":b[0][24],"long":b[0][292]},{"short":b[0][294],"long":b[0][295]},{"short":b[0][188],"long":b[0][188]},{"short":b[0][95],"long":b[0][296]},{"short":b[0][31],"long":b[0][297]},{"narrow":b[0][34],"short":b[0][298]},{"short":b[0][299],"long":b[0][299]},{"short":b[0][300]},{"latn":b[0][301]},[b[0][303],b[0][304],b[0][116],b[0][305],b[0][90],b[0][6],b[0][91],b[0][92],b[0][241],b[0][242]],{"long":b[0][306]},{"long":b[0][307]},{"narrow":b[0][308],"short":b[0][309],"long":b[0][310]},{"narrow":b[0][311],"short":b[0][312],"long":b[0][313]},{"short":b[0][314],"long":b[0][315]},{"long":b[0][317]},{"short":b[0][318],"long":b[0][318]},{"short":b[0][319]},{"long":b[0][320]},{"decimal":b[0][40],"currency":b[0][41],"percent":b[0][321]},[b[0][323],b[0][324],b[0][206],b[0][207],b[0][208],b[0][209],b[0][210],b[0][67],b[0][211],b[0][212]],{"short":b[0][325]},{"narrow":b[0][216],"short":b[0][326],"long":b[0][327]},{"narrow":b[0][93],"short":b[0][219],"long":b[0][328]},{"narrow":b[0][329],"short":b[0][329],"long":b[0][330]},{"narrow":b[0][331],"short":b[0][331],"long":b[0][331]},{"short":b[0][333],"long":b[0][334]},{"short":b[0][335]},{"short":b[0][336]},{"short":b[0][337]},{"narrow":b[0][34],"short":b[0][338]},{"short":b[0][339]}];b[2]=[{"eras":b[1][1]},{"months":b[1][2]},{"months":b[1][3],"eras":b[1][4]},{"months":b[1][5],"eras":b[1][4]},{"eras":b[1][6]},{"months":b[1][2],"eras":b[1][4]},{"months":b[1][7],"days":b[1][8],"eras":b[1][9],"dayPeriods":b[0][26]},{"months":b[1][10],"eras":b[1][11]},{"months":b[1][12],"eras":b[1][13]},{"months":b[1][14],"eras":b[1][15]},{"eras":b[1][16]},{"months":b[1][17],"eras":b[1][18]},{"eras":b[1][19]},{"nu":b[0][39],"patterns":b[1][20],"symbols":b[1][21],"currencies":b[0][44]},{"months":b[1][23],"days":b[1][24],"eras":b[1][25],"dayPeriods":b[0][59]},{"nu":b[0][39],"patterns":b[1][26],"symbols":b[1][27],"currencies":b[0][62]},{"nu":b[0][39],"patterns":b[1][20],"symbols":b[1][21],"currencies":b[0][62]},{"months":b[1][29]},{"months":b[1][30],"days":b[1][31],"eras":b[1][32],"dayPeriods":b[0][26]},{"nu":b[0][39],"patterns":b[1][33],"symbols":b[1][34],"currencies":b[0][81]},{"nu":b[0][39],"patterns":b[1][33],"symbols":b[1][34],"currencies":b[0][85]},{"months":b[1][37]},{"months":b[1][30],"days":b[1][31],"eras":b[1][32],"dayPeriods":b[0][94]},{"months":b[1][38],"eras":b[1][39]},{"months":b[1][40],"eras":b[1][15]},{"nu":b[0][39],"patterns":b[1][33],"symbols":b[1][34],"currencies":b[0][96]},{"eras":b[1][42]},{"nu":b[0][39],"patterns":b[1][33],"symbols":b[1][34],"currencies":b[0][101]},{"months":b[1][30],"days":b[1][31],"eras":b[1][32],"dayPeriods":b[0][104]},{"nu":b[0][39],"patterns":b[1][33],"symbols":b[1][34],"currencies":b[0][105]},{"nu":b[0][39],"patterns":b[1][45],"symbols":b[1][34],"currencies":b[0][109]},{"nu":b[0][39],"patterns":b[1][33],"symbols":b[1][34],"currencies":b[0][111]},{"nu":b[0][39],"patterns":b[1][33],"symbols":b[1][34],"currencies":b[0][113]},{"nu":b[0][39],"patterns":b[1][33],"symbols":b[1][49],"currencies":b[0][121]},{"months":b[1][51],"days":b[1][52],"eras":b[1][53],"dayPeriods":b[0][136]},{"eras":b[1][54]},{"nu":b[0][39],"patterns":b[1][55],"symbols":b[1][21],"currencies":b[0][139]},{"nu":b[0][39],"patterns":b[1][57],"symbols":b[1][21],"currencies":b[0][144]},{"nu":b[0][39],"patterns":b[1][55],"symbols":b[1][21],"currencies":b[0][145]},{"nu":b[0][39],"patterns":b[1][59],"symbols":b[1][21],"currencies":b[0][146]},{"months":b[1][61],"days":b[1][62],"eras":b[1][63],"dayPeriods":b[0][104]},{"nu":b[0][39],"patterns":b[1][33],"symbols":b[1][34],"currencies":b[0][155]},{"nu":b[0][39],"patterns":b[1][64],"symbols":b[1][21],"currencies":b[0][156]},{"nu":b[0][39],"patterns":b[1][57],"symbols":b[1][21],"currencies":b[0][157]},{"eras":b[1][66]},{"months":b[1][67]},{"months":b[1][68],"eras":b[1][69]},{"months":b[1][70],"eras":b[1][71]},{"months":b[1][72],"days":b[1][73],"eras":b[1][74],"dayPeriods":b[0][26]},{"months":b[1][75],"eras":b[1][76]},{"months":b[1][77],"eras":b[1][39]},{"months":b[1][78],"eras":b[1][15]},{"eras":b[1][79]},{"nu":b[0][39],"patterns":b[1][20],"symbols":b[1][49],"currencies":b[0][192]},{"eras":b[1][81]},{"months":b[1][82],"days":b[1][83],"eras":b[1][84],"dayPeriods":b[0][26]},{"eras":b[1][85]},{"nu":b[0][39],"patterns":b[1][59],"symbols":b[1][21],"currencies":b[0][203]},{"eras":b[1][87]},{"months":b[1][88]},{"months":b[1][89],"eras":b[1][4]},{"months":b[1][90],"eras":b[1][4]},{"months":b[1][91],"days":b[1][92],"eras":b[1][93],"dayPeriods":b[0][223]},{"months":b[1][94],"eras":b[1][11]},{"months":b[1][95],"eras":b[1][96]},{"months":b[1][97],"eras":b[1][15]},{"eras":b[1][98]},{"months":b[1][99],"eras":b[1][18]},{"eras":b[1][100]},{"nu":b[0][39],"patterns":b[1][33],"symbols":b[1][34],"currencies":b[0][233]},{"eras":b[1][102]},{"months":b[1][103],"eras":b[1][4]},{"months":b[1][104]},{"months":b[1][105],"eras":b[1][4]},{"months":b[1][106],"days":b[1][107],"eras":b[1][108],"dayPeriods":b[0][251]},{"months":b[1][109],"eras":b[1][11]},{"eras":b[1][110]},{"eras":b[1][111]},{"nu":b[0][39],"patterns":b[1][112],"symbols":b[1][34],"currencies":b[0][256]},{"months":b[1][114]},{"months":b[1][115],"eras":b[1][4]},{"months":b[1][116]},{"months":b[1][117],"eras":b[1][4]},{"months":b[1][118],"days":b[1][119],"eras":b[1][120],"dayPeriods":b[0][26]},{"months":b[1][121],"eras":b[1][11]},{"months":b[1][122],"eras":b[1][39]},{"months":b[1][123],"eras":b[1][124]},{"months":b[1][125],"eras":b[1][18]},{"nu":b[0][39],"patterns":b[1][126],"symbols":b[1][21],"currencies":b[0][274]},{"months":b[1][128]},{"months":b[1][129],"eras":b[1][4]},{"months":b[1][130],"eras":b[1][4]},{"months":b[1][131],"days":b[1][132],"eras":b[1][133],"dayPeriods":b[0][26]},{"months":b[1][134],"eras":b[1][11]},{"months":b[1][38],"eras":b[1][13]},{"eras":b[1][135]},{"nu":b[0][39],"patterns":b[1][33],"symbols":b[1][21],"currencies":b[0][283]},{"months":b[1][137],"eras":b[1][4]},{"months":b[1][138],"eras":b[1][4]},{"months":b[1][139],"days":b[1][140],"eras":b[1][141],"dayPeriods":b[0][293]},{"months":b[1][142],"eras":b[1][11]},{"months":b[1][143],"eras":b[1][144]},{"months":b[1][145],"eras":b[1][15]},{"eras":b[1][146]},{"months":b[1][147],"eras":b[1][18]},{"eras":b[1][148]},{"nu":b[0][39],"patterns":b[1][20],"symbols":b[1][149],"currencies":b[0][302]},{"months":b[1][151],"eras":b[1][4]},{"months":b[1][152],"eras":b[1][4]},{"months":b[1][153],"days":b[1][154],"eras":b[1][155],"dayPeriods":b[0][316]},{"months":b[1][156],"eras":b[1][11]},{"months":b[1][157],"eras":b[1][158]},{"months":b[1][159],"eras":b[1][18]},{"nu":b[0][39],"patterns":b[1][160],"symbols":b[1][21],"currencies":b[0][322]},{"eras":b[1][162]},{"months":b[1][163],"eras":b[1][4]},{"months":b[1][164],"days":b[1][165],"eras":b[1][166],"dayPeriods":b[0][332]},{"months":b[1][167],"eras":b[1][168]},{"months":b[1][164],"eras":b[1][169]},{"months":b[1][164],"eras":b[1][170]},{"eras":b[1][171]},{"months":b[1][164],"eras":b[1][172]},{"nu":b[0][39],"patterns":b[1][64],"symbols":b[1][34],"currencies":b[0][340]}];b[3]=[{"buddhist":b[2][0],"chinese":b[2][1],"coptic":b[2][2],"ethiopic":b[2][3],"ethioaa":b[2][4],"generic":b[2][5],"gregory":b[2][6],"hebrew":b[2][7],"indian":b[2][8],"islamic":b[2][9],"japanese":b[2][10],"persian":b[2][11],"roc":b[2][12]},{"buddhist":b[2][0],"chinese":b[2][1],"coptic":b[2][2],"ethiopic":b[2][3],"ethioaa":b[2][4],"generic":b[2][5],"gregory":b[2][14],"hebrew":b[2][7],"indian":b[2][8],"islamic":b[2][9],"japanese":b[2][10],"persian":b[2][11],"roc":b[2][12]},{"buddhist":b[2][0],"chinese":b[2][17],"coptic":b[2][2],"ethiopic":b[2][3],"ethioaa":b[2][4],"generic":b[2][5],"gregory":b[2][18],"hebrew":b[2][7],"indian":b[2][8],"islamic":b[2][9],"japanese":b[2][10],"persian":b[2][11],"roc":b[2][12]},{"buddhist":b[2][0],"chinese":b[2][21],"coptic":b[2][2],"ethiopic":b[2][3],"ethioaa":b[2][4],"generic":b[2][5],"gregory":b[2][22],"hebrew":b[2][7],"indian":b[2][23],"islamic":b[2][24],"japanese":b[2][10],"persian":b[2][11],"roc":b[2][12]},{"buddhist":b[2][0],"chinese":b[2][17],"coptic":b[2][2],"ethiopic":b[2][3],"ethioaa":b[2][4],"generic":b[2][5],"gregory":b[2][18],"hebrew":b[2][7],"indian":b[2][8],"islamic":b[2][9],"japanese":b[2][26],"persian":b[2][11],"roc":b[2][12]},{"buddhist":b[2][0],"chinese":b[2][17],"coptic":b[2][2],"ethiopic":b[2][3],"ethioaa":b[2][4],"generic":b[2][5],"gregory":b[2][28],"hebrew":b[2][7],"indian":b[2][8],"islamic":b[2][9],"japanese":b[2][10],"persian":b[2][11],"roc":b[2][12]},{"buddhist":b[2][0],"chinese":b[2][1],"coptic":b[2][2],"ethiopic":b[2][3],"ethioaa":b[2][4],"generic":b[2][5],"gregory":b[2][34],"hebrew":b[2][7],"indian":b[2][8],"islamic":b[2][9],"japanese":b[2][10],"persian":b[2][11],"roc":b[2][35]},{"buddhist":b[2][0],"chinese":b[2][1],"coptic":b[2][2],"ethiopic":b[2][3],"ethioaa":b[2][4],"generic":b[2][5],"gregory":b[2][40],"hebrew":b[2][7],"indian":b[2][8],"islamic":b[2][9],"japanese":b[2][10],"persian":b[2][11],"roc":b[2][35]},{"buddhist":b[2][44],"chinese":b[2][45],"coptic":b[2][46],"dangi":b[2][45],"ethiopic":b[2][47],"ethioaa":b[2][4],"generic":b[2][5],"gregory":b[2][48],"hebrew":b[2][49],"indian":b[2][50],"islamic":b[2][51],"japanese":b[2][10],"persian":b[2][11],"roc":b[2][52]},{"buddhist":b[2][54],"chinese":b[2][1],"coptic":b[2][2],"ethiopic":b[2][3],"ethioaa":b[2][4],"generic":b[2][5],"gregory":b[2][55],"hebrew":b[2][7],"indian":b[2][8],"islamic":b[2][9],"japanese":b[2][10],"persian":b[2][11],"roc":b[2][56]},{"buddhist":b[2][58],"chinese":b[2][59],"coptic":b[2][60],"dangi":b[2][59],"ethiopic":b[2][61],"ethioaa":b[2][4],"generic":b[2][5],"gregory":b[2][62],"hebrew":b[2][63],"indian":b[2][64],"islamic":b[2][65],"japanese":b[2][66],"persian":b[2][67],"roc":b[2][68]},{"buddhist":b[2][70],"chinese":b[2][1],"coptic":b[2][71],"dangi":b[2][72],"ethiopic":b[2][73],"ethioaa":b[2][4],"generic":b[2][5],"gregory":b[2][74],"hebrew":b[2][75],"indian":b[2][8],"islamic":b[2][9],"japanese":b[2][76],"persian":b[2][11],"roc":b[2][77]},{"buddhist":b[2][0],"chinese":b[2][79],"coptic":b[2][80],"dangi":b[2][81],"ethiopic":b[2][82],"ethioaa":b[2][4],"generic":b[2][5],"gregory":b[2][83],"hebrew":b[2][84],"indian":b[2][85],"islamic":b[2][86],"japanese":b[2][10],"persian":b[2][87],"roc":b[2][12]},{"buddhist":b[2][0],"chinese":b[2][89],"coptic":b[2][90],"ethiopic":b[2][91],"ethioaa":b[2][4],"generic":b[2][5],"gregory":b[2][92],"hebrew":b[2][93],"indian":b[2][94],"islamic":b[2][9],"japanese":b[2][10],"persian":b[2][87],"roc":b[2][95]},{"buddhist":b[2][0],"chinese":b[2][1],"coptic":b[2][97],"dangi":b[0][285],"ethiopic":b[2][98],"ethioaa":b[2][4],"generic":b[2][5],"gregory":b[2][99],"hebrew":b[2][100],"indian":b[2][101],"islamic":b[2][102],"japanese":b[2][103],"persian":b[2][104],"roc":b[2][105]},{"buddhist":b[2][0],"chinese":b[2][1],"coptic":b[2][107],"ethiopic":b[2][108],"ethioaa":b[2][4],"generic":b[2][5],"gregory":b[2][109],"hebrew":b[2][110],"indian":b[2][8],"islamic":b[2][111],"japanese":b[2][10],"persian":b[2][112],"roc":b[2][12]},{"buddhist":b[2][114],"chinese":b[2][59],"coptic":b[2][115],"ethiopic":b[2][115],"ethioaa":b[2][4],"generic":b[2][5],"gregory":b[2][116],"hebrew":b[2][117],"indian":b[2][118],"islamic":b[2][119],"japanese":b[2][120],"persian":b[2][121],"roc":b[2][68]}];b[4]=[{"ca":b[0][0],"hourNo0":true,"hour12":false,"formats":b[1][0],"calendars":b[3][0]},{"ca":b[0][0],"hourNo0":true,"hour12":false,"formats":b[1][22],"calendars":b[3][1]},{"ca":b[0][0],"hourNo0":true,"hour12":true,"formats":b[1][28],"calendars":b[3][2]},{"ca":b[0][0],"hourNo0":true,"hour12":true,"formats":b[1][35],"calendars":b[3][2]},{"ca":b[0][0],"hourNo0":true,"hour12":false,"formats":b[1][36],"calendars":b[3][3]},{"ca":b[0][0],"hourNo0":true,"hour12":true,"formats":b[1][41],"calendars":b[3][4]},{"ca":b[0][0],"hourNo0":true,"hour12":true,"formats":b[1][43],"calendars":b[3][5]},{"ca":b[0][0],"hourNo0":true,"hour12":true,"formats":b[1][44],"calendars":b[3][2]},{"ca":b[0][0],"hourNo0":true,"hour12":true,"formats":b[1][46],"calendars":b[3][2]},{"ca":b[0][0],"hourNo0":true,"hour12":true,"formats":b[1][47],"calendars":b[3][2]},{"ca":b[0][0],"hourNo0":true,"hour12":true,"formats":b[1][48],"calendars":b[3][2]},{"ca":b[0][0],"hourNo0":true,"hour12":false,"formats":b[1][50],"calendars":b[3][6]},{"ca":b[0][0],"hourNo0":true,"hour12":false,"formats":b[1][56],"calendars":b[3][6]},{"ca":b[0][0],"hourNo0":true,"hour12":true,"formats":b[1][58],"calendars":b[3][6]},{"ca":b[0][0],"hourNo0":true,"hour12":false,"formats":b[1][58],"calendars":b[3][6]},{"ca":b[0][0],"hourNo0":true,"hour12":false,"formats":b[1][60],"calendars":b[3][7]},{"ca":b[0][158],"hourNo0":true,"hour12":false,"formats":b[1][65],"calendars":b[3][8]},{"ca":b[0][0],"hourNo0":true,"hour12":false,"formats":b[1][80],"calendars":b[3][9]},{"ca":b[0][158],"hourNo0":false,"hour12":false,"formats":b[1][86],"calendars":b[3][10]},{"ca":b[0][158],"hourNo0":true,"hour12":true,"formats":b[1][101],"calendars":b[3][11]},{"ca":b[0][158],"hourNo0":true,"hour12":false,"formats":b[1][113],"calendars":b[3][12]},{"ca":b[0][0],"hourNo0":true,"hour12":false,"formats":b[1][127],"calendars":b[3][13]},{"ca":b[0][158],"hourNo0":true,"hour12":false,"formats":b[1][136],"calendars":b[3][14]},{"ca":b[0][0],"hourNo0":true,"hour12":false,"formats":b[1][150],"calendars":b[3][15]},{"ca":b[0][0],"hourNo0":true,"hour12":true,"formats":b[1][161],"calendars":b[3][16]}];b[5]=[{"date":b[4][0],"number":b[2][13]},{"date":b[4][1],"number":b[2][15]},{"date":b[4][1],"number":b[2][16]},{"date":b[4][2],"number":b[2][19]},{"date":b[4][3],"number":b[2][20]},{"date":b[4][4],"number":b[2][25]},{"date":b[4][5],"number":b[2][27]},{"date":b[4][6],"number":b[2][29]},{"date":b[4][7],"number":b[2][30]},{"date":b[4][8],"number":b[2][31]},{"date":b[4][9],"number":b[2][32]},{"date":b[4][9],"number":b[2][29]},{"date":b[4][10],"number":b[2][33]},{"date":b[4][11],"number":b[2][36]},{"date":b[4][12],"number":b[2][37]},{"date":b[4][13],"number":b[2][38]},{"date":b[4][14],"number":b[2][39]},{"date":b[4][15],"number":b[2][41]},{"date":b[4][14],"number":b[2][42]},{"date":b[4][14],"number":b[2][43]},{"date":b[4][16],"number":b[2][53]},{"date":b[4][17],"number":b[2][57]},{"date":b[4][18],"number":b[2][69]},{"date":b[4][19],"number":b[2][78]},{"date":b[4][20],"number":b[2][88]},{"date":b[4][21],"number":b[2][96]},{"date":b[4][22],"number":b[2][106]},{"date":b[4][23],"number":b[2][113]},{"date":b[4][24],"number":b[2][122]}];addLocaleData(b[5][0], "da-DK");addLocaleData(b[5][1], "de-CH");addLocaleData(b[5][2], "de-DE");addLocaleData(b[5][3], "en-AU");addLocaleData(b[5][4], "en-CA");addLocaleData(b[5][5], "en-GB");addLocaleData(b[5][6], "en-HK");addLocaleData(b[5][7], "en-IE");addLocaleData(b[5][8], "en-IN");addLocaleData(b[5][9], "en-NZ");addLocaleData(b[5][10], "en-SG");addLocaleData(b[5][11], "en-US");addLocaleData(b[5][12], "en-ZA");addLocaleData(b[5][13], "es-AR");addLocaleData(b[5][14], "es-CL");addLocaleData(b[5][15], "es-CO");addLocaleData(b[5][16], "es-ES");addLocaleData(b[5][17], "es-MX");addLocaleData(b[5][18], "es-UY");addLocaleData(b[5][19], "es-VE");addLocaleData(b[5][20], "fr-FR");addLocaleData(b[5][21], "it-IT");addLocaleData(b[5][22], "ja-JP");addLocaleData(b[5][23], "ko-KR");addLocaleData(b[5][24], "nl-NL");addLocaleData(b[5][25], "pt-BR");addLocaleData(b[5][26], "sv-SE");addLocaleData(b[5][27], "tr-TR");addLocaleData(b[5][28], "zh-Hant-TW");})();
return Intl;
});
