" Vim syntax file
" Language: SCSCM (Lisp HyperCollider / lhc)
" File types: *.scscm

if exists('b:current_syntax')
  finish
endif

" ── Comments ────────────────────────────────────────────────────────────────
syntax match scscmComment /;.*$/ contains=@Spell
highlight default link scscmComment Comment

" ── Strings ─────────────────────────────────────────────────────────────────
syntax region scscmString start=/"/ skip=/\\./ end=/"/ contains=scscmStringEscape
syntax match  scscmStringEscape /\\./ contained
highlight default link scscmString  String
highlight default link scscmStringEscape SpecialChar

" ── Numbers ─────────────────────────────────────────────────────────────────
syntax match scscmNumber /-\?\(0x[0-9a-fA-F]\+\|[0-9]\+\(\.[0-9]\+\)\?\([eE][+-]\?[0-9]\+\)\?\)/
highlight default link scscmNumber Number

" ── Boolean / nil ───────────────────────────────────────────────────────────
syntax keyword scscmBoolean true false nil
highlight default link scscmBoolean Boolean

" ── Keyword symbols  :freq  :doneAction ─────────────────────────────────────
syntax match scscmKeywordSymbol /:[a-zA-Z_\-][a-zA-Z0-9_\-!?/]*/
highlight default link scscmKeywordSymbol Constant

" ── Quote / quasiquote / unquote operators ───────────────────────────────────
syntax match scscmQuoteOp /'\|`\|~@\|~/
highlight default link scscmQuoteOp Operator

" ── Hash-fn shorthand  #(…)  and  %1  %2  %& ────────────────────────────────
syntax match scscmHashFn  /#(/he=e-1
syntax match scscmHashArg /%\([0-9]\+\|&\)\?/
highlight default link scscmHashFn  Operator
highlight default link scscmHashArg Special

" ── Core special forms ───────────────────────────────────────────────────────
syntax keyword scscmSpecial
      \ fn defn defmacro var set! let if cond do
      \ class list array dict quote quasiquote super
highlight default link scscmSpecial Keyword

" ── Overtone / SCSCM domain macros ──────────────────────────────────────────
syntax keyword scscmMacro
      \ defsynth definst
      \ pbind pseq prand pwhite pgeom
      \ routine wait
      \ ctl kill now metronome at in demo
      \ midi->hz hz->midi db->amp amp->db
      \ adsr perc env-line chord degrees->pitches
      \ -> ->>
      \ when unless
      \ doseq dotimes collect icollect accumulate
      \ comp partial
highlight default link scscmMacro Function

" ── SuperCollider UGen / class methods  SinOsc.ar  Env.perc ─────────────────
syntax match scscmUGenMethod /\<[A-Z][A-Za-z0-9_]*\.\(ar\|kr\|ir\|dr\|new\|perc\|adsr\|asr\|triangle\|sine\|pairs\|get\|put\|play\|stop\|free\|run\|set\|setn\|fill\|do\|collect\|detect\|reject\|select\|inject\|at\|add\|remove\|includes\|size\|isKindOf\|respondsTo\|postln\|post\|nl\|value\|valueArray\|valueWithEnvir\)\>/
highlight default link scscmUGenMethod Type

" ── PascalCase identifiers — SC class / UGen names ──────────────────────────
syntax match scscmClass /\<[A-Z][A-Za-z0-9_]*\>/
highlight default link scscmClass Type

" ── Parentheses / brackets ───────────────────────────────────────────────────
syntax match scscmParen /[()[\]]/
highlight default link scscmParen Delimiter

let b:current_syntax = 'scscm'
