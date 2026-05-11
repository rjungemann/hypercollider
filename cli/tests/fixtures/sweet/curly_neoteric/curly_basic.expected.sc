// Curly-infix forms - basic operators
// These should compile to equivalent s-expressions

// { a + b } -> (+ a b)
(+ 1 2)

// { a * b } -> (* a b)
(* 3 4)

// { a - b } -> (- a b)
(- 10 3)

// { a / b } -> (/ a b)
(/ 10 2)

// Chained: { a + b + c } -> (+ a b c)
(+ 1 2 3)
