// Neoteric call sugar - basic forms
// These should compile to equivalent s-expressions

// f(x) -> (f x)
(sin 440.0)

// f(x y) -> (f x y)
(add 1 2)

// f() -> (f)
(printf)

// Nested: f(g(x)) -> (f (g x))
(sin (mul 2 220.0))
