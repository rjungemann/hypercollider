" ftplugin for scscm — basic editing settings
if exists('b:did_ftplugin')
  finish
endif
let b:did_ftplugin = 1

setlocal commentstring=;\ %s
setlocal comments=:;
setlocal lisp
setlocal lispwords+=defn,defsynth,definst,let,fn,when,unless,doseq,dotimes,collect,icollect,accumulate,pbind,routine
