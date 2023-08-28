# Description
## Lexical format
### Characters
```
    source           ::= char*
    char             ::= '0' | ... | '9'
                       | 'A' | ... | 'Z'
                       | 'a' | ... | 'z' | '_'
                       | '(' | ')' | '{' | '}' | ':' | '=' | ';' | '\' | '.' | '-' | '>'
                       | ' ' | U+0A | U+0D
```
### White Space
```
    space            ::= (hws | vws | comment)*
    hws              ::= ' '
    vws              ::= U+0A U+0D? | U+0D
```
### Comments
```
    comment          ::= linecomment | blockcomment
    linecomment      ::= '--' linechars (vws | eof)
    linechars        ::= cs:char*                     , cs does not contain vws
    blockcomment     ::= '{-' blockchars '-}'
    blockchars       ::= cs:char*                     , cs does not contain '-}'
```
## Expressions
```
    identifier       ::=  i:(identinitchar identbodychar*)
        => Var i, i is not in 'let' | 'U' | '_'
    identinitchar    ::= 'a' | ... | 'z' | 'A' | ... | 'Z' | '_'
    identbodychar    ::= identinitchar | '0' | ... | '9'

    typeoftypes      ::= 'U'
        => U
    hole             ::= '_'
        => Hole
    atom             ::= identifier | typeoftypes | hole | '(' term ')'

    nameimplicit     ::= identifier '='
    arg              ::= '{' nameimplicit term '}' | '{' term '}' | atom

    binder           ::= identifier | '_'
    spine            ::= head:atom a*:arg*
        => App... (App head a[0]) a[1]...

    lambinder        ::= '(' name:binder ':' type?:term ')'
                       | '{' name:binder (':' type?:term)? '}'
                       | '{' name:nameimplicit ni:binder '}'
    lambda           ::= '\' b*:lambinder* '.' body:term
        => Lam... b[1] (Lam b[0] body)...

    pibinder         ::= '{' b*:binder* (':' (domain | hole):term)? '}'
                       | '(' b*:binder* ':' domain:term ')'
    pi               ::= b**:pibinder* '->' codomain:term | spine '->' codomain:term
        => Pi b[0,0] dom[0] (Pi b[0,1] dom[0] ...(Pi b[1,0] dom[1] ... cod)...)

    let              ::= 'let' name:identifier (':' type:term)? '=' expr:term ';' next:term
        => Let name (type | hole) expr next

    term             ::= lambda | pi | let
```
## Structure
### Let terms
A program consists of a series of let expressions, with a final evaluand term:
```
    let ...;
    let ...;
    ...
    expr
```
Each let consists of an identifier, optionally the type of the identifier, and its term expression:
```
    let typeoftypes : U = U;
```
If the type is not supplied, or is given as an underscore, a "hole" is inserted, which stands for a value to potentially be solved later.  
Types must either be a `U` (for Universe) or a pi term.
### Pi terms
A pi term consists of a number of binders interspersed with arrows, indicating that it represents a function type:
```
    (A : U) -> A -> A
```
Here, `A` is a term of type `U`, in other words a type itself. A named term can be referred to anywhere to its right within the pi term.  
A binder enclosed in braces is implicit; it represents a value that can be skipped:
```
    {A} -> A -> A
```
Here, the type of `A` is not given, which is equivalent to having a hole where the type goes.
Multiple identifiers can be given in a single binder, whether implicit or explicit:
```
    {A B : U} -> A -> B
```
### Lambda terms
Terms can also be lambdas, in other words functions. A lambda term consists of a number of binders on the left hand side, and an expression on the right hand side:
```
    \x y. x
```
Binders can be implicit, corresponding to the leftmost implicit type in that part of the type signature, or it can be a named implicit, corresponding to the implicit type with that name:
```
    let example : {A}{f g : U -> A -> U} -> A = \{A}{g=g} x. g A x
```
### Applied terms
Function application consists of a function identifier followed by a series of terms to be applied. Applied terms can also be implicit or named:
```
    example {A}{g=g} x
```
# Applications
## Encoding data types
Since there are no constructors, records, or any other language features than what has been mentioned, commonly used structures have to be defined by encoding.

The Berarducci-Boehm encoding, known colloquially as the Church encoding, is quite versatile. Some examples follow.
### Void, Unit, Bool
`Void` is the type without constructors, also known as Bottom, and its eliminator is called `absurd` as it is impossible to be applied. We use a hole to represent a value which cannot be solved:
```
    let Void : U                     = (V : U) -> V;
    let absurd : {A} -> Void -> A    = \V. _;
```
`Unit` is the type with a single constructor, also known as Top. Its constructor can be used to specify the type of some term (sometimes known as `the`):
```
    let Unit : U                     = (T : U) -> T -> T;
    let tt : Unit                    = \T t. t;

    tt (Unit -> Unit) (\x. x)
```
`Bool` is the type with two constructors. We can represent boolean and other datatype functions by reapplying variables in different combinations; for example, this `and` corresponds to the pattern matching pseudocode definition `1 && y := y; 0 && y := x`:
```
    let Bool : U                     = (B : U) -> B -> B -> B;
    let I : Bool                     = \B i o. i;
    let O : Bool                     = \B i o. o;

    let not : Bool -> Bool           = \b B i o. b B o i;
    let and : Bool -> Bool -> Bool   = \x y B i o. x B (y B i o) (x B i o);
```
### Wrap, Pair
`Wrap` is the identity datatype, with constructor `wrap` and eliminator `unwrap`. A value of type `Wrap A` has a value of type `A` inside it:
```
    let Wrap : U -> U                = \A. (W : U) -> (A -> W) -> W;
    let wrap : {A} -> A -> Wrap A    = \a W w. w a;
    let unwrap : {A} -> Wrap A -> A  = \{A} w. w A (\x. x);
```
`Pair` is the ordered pair datatype, also known as a product or Cartesian product type, with constructor `pair` and eliminators `fst` and `snd`, the first and second projections:
```
    let Pair : U -> U -> U           = \A B. (P : U) -> (A -> B -> P) -> P;
    let pair : {A B} -> A -> B -> Pair A B
        = \a b P p. p a b;
    let fst : {A B} -> Pair A B -> A = \{A} s. s A (\a b. a);
    let snd : {A B} -> Pair A B -> B = \{B=B} s. s B (\a b. b);
```
### Nat
`Nat` is the type of natural numbers, with constructors `zero` and `suc` (successor). Using `Pair`, we can construct a fold over the naturals which can be adapted to other datatypes:
```
    let Nat : U                      = (N : U) -> (N -> N) -> N -> N;
    let zero : Nat                   = \N s z. z;
    let suc : Nat -> Nat             = \n N s z. s (n N s z);
    let add : Nat -> Nat -> Nat      = \a b N s z. a N s (b N s z);

    let foldnat : {A} -> (Nat -> A -> A) -> A -> Nat -> A
        = \{A} reducer base n. snd {Nat} (n (Pair Nat A)
            (\p. pair (suc (fst p)) (reducer (fst p) (snd p))) (pair zero base));
    let pred : Nat -> Nat = foldnat (\n _. n) zero;
```

### Maybe, Either
`Maybe` is a wrapper type which adds a single extra value, which works like a null. The constructors are `nothing` and `just`:
```
    let Maybe : U -> U               = \A. (M : U) -> M -> (A -> M) -> M;
    let nothing : {A} -> Maybe A     = \M n j. n;
    let just : {A} -> A -> Maybe A   = \a M n j. j a;
```
`Either` is the sum type, and can be used for failure with a message. The constructors are `left` and `right`, otherwise known as `inl` and `inr`:
```
    let Either : U -> U -> U                = \A B. (E : U) -> (A -> E) -> (B -> E) -> E;
    let left : {A B} -> A -> Either A B     = \a E l r. l a;
    let right : {A B} -> B -> Either A B    = \b E l r. r b;
```
### List, Nonempty
`List` is the type of lists, constructed from `nil`, the zero-length list, and `cons`, the list extension by one value. Fold can be defined on lists, and used to lookup and update values:
```
    let List : U -> U                       = \A. (L : U) -> L -> (A -> L -> L) -> L;
    let nil  : {A} -> List A                = \L n c. n;
    let cons : {A} -> A -> List A -> List A = \a as L n c. c a (as L n c);
    let concat : {A} -> List A -> List A -> List A
        = \{A} la lb. la (List A) lb cons;

    let foldlist : {A B} -> (List A -> A -> B -> B) -> B -> List A -> B
        = \{A}{B} reducer base l. snd {List A} (l (Pair (List A) B) (pair nil base)
            (\a p. pair (cons a (fst p)) (reducer (fst p) a (snd p))));

    let listHead : {A} -> List A -> A       = \{A} l. l A _ (\a as. a);
    let listTail : {A} -> List A -> List A  = \{A}. foldlist {A}{List A} (\l _ _. l) nil;
    let listLookup : {A}(l : List A) -> Fin {length l} -> A
        = \{A} l fn. listHead (fn (\n. List A) (\acc. listTail acc) l);
    let listUpdate : {A} -> Nat -> List A -> A -> List A
        = \{A} n l newA. foldlist {A}{List A}
            (\l a acc. cons ((diff n (length l)) A (\_. a) newA) acc) nil l;
```
`Nonempty` is the type of non-empty lists:
```
    let Nonempty : U -> U
        = \A. (N : U) -> (A -> N) -> (A -> N -> N) -> N;
    let sing : {A} -> A -> Nonempty A       = \a N s c. s a;
    let ncons : {A} -> A -> Nonempty A -> Nonempty A
        = \a as N s c. c a (as N s c);
    let nelToList : {A} -> Nonempty A -> List A
        = \{A} nel. nel (List A) (\a. cons a nil) cons;
```
### BTree, RTree
`BTree` is the type of Binary trees:
```
    let BTree : U -> U
        = \A. (B : U) -> (B -> B -> B) -> (A -> B) -> B;
    let bleaf : {A} -> A -> BTree A         = \a B n l. l a;
    let bnode : {A} -> BTree A -> BTree A -> BTree A
        = \ta tb B n l. n (ta B n l) (tb B n l);
```
`RTree` is the type of Rose trees:
```
    let RTree : U -> U
        = \A. (R : U) -> (R -> R -> R) -> (A -> R -> R) -> R -> R;
    let rnil : {A} -> RTree A               = \R t l n. n;
    let rleaf : {A} -> A -> RTree A -> RTree A
        = \a r R t l n. l a (r R t l n);
    let rnode : {A} -> RTree A -> RTree A -> RTree A
        = \tx ty R t l n. t (tx R t l n) (ty R t l n);
```
### Cont
`Cont` is the type of continuations, with constructor `cont` and eliminator `run`:
```
    let Cont : U -> U -> U
        = \W A. (C : U) -> (((A -> W) -> W) -> C) -> C;
    let cont : {W A} -> ((A -> W) -> W) -> Cont W A
        = \f C c. c f;
    let run : {W A} -> Cont W A -> (A -> W) -> W
        = \{W} c f. c W (\k. k f);

    let reset : {W} -> Cont W W -> W        = \m. run m (\x. x);
    let shift : {W A} -> ((A -> W) -> Cont W W) -> Cont W A
        = \e. cont (\k. reset (e k));
```
## Encoding dependent data types
This encoding can be extended to dependent types by making the carrier type a function over the indices.
### DWrap, DNats
```
    let DWrap : {T} -> T -> U
        = \{T} t. (W : T -> U) -> ((x : T) -> W x) -> W t;
    let dwrap : {T} -> (t : T) -> DWrap {T} t
        = \{V} v W w. w v;
    let undwrap : {T t} -> DWrap {T} t -> T = \{V}{v} w. w (\_. V) (\_. v);
```
Currently researching dfoldnat, with a tentative type signature of:  
`{n : Nat}(P : Nat -> U -> U)(A : Nat -> U){m : Nat}(f : Nat -> Nat -> Nat) ->`  
`({p q} -> DNat {p} -> P q (A p) -> P (f q p) (A (suc p))) -> P m (A zero) ->`  
` DNat {n} -> P (foldnat f m n) (A n)`
```
    let DNat : {n} -> U
        = \{n}. (DN : Nat -> U) -> ({m} -> DN m -> DN (suc m)) -> DN zero -> DN n;
    let dz : DNat {zero}                    = \DN s z. z;
    let ds : {n} -> DNat {n} -> DNat {suc n}
        = \n DN s z. s (n DN s z);
    let dadd : {m n} -> DNat {m} -> DNat {n} -> DNat {add m n}
        = \{n=n} a b DN s z. a (\k. DN (add k n)) s (b DN s z);
```
### Fin
```
    let Fin : {n} -> U
        = \{n}. (F : Nat -> U) -> ({m} -> F m -> F (suc m)) -> ({m} -> F (suc m)) -> F n;
    let fz : {n} -> Fin {suc n}             = \F s z. z;
    let fs : {n} -> Fin {n} -> Fin {suc n}  = \f F s z. s (f F s z);
```
### Vec
```
    let Vec : {n} -> U -> U
        = \{n} A. (V : Nat -> U) -> V zero -> ({m} -> A -> V m -> V (suc m)) -> V n;
    let vnil : {A} -> Vec {zero} A          = \V n c. n;
    let vcons : {A n} -> A -> Vec {n} A -> Vec {suc n} A
        = \a as V n c. c a (as V n c);
```
### Tuple
```
    let Tuple : List U -> U
        = \L. (T : List U -> U) -> T nil -> ({A As} -> A -> T As -> T (cons A As)) -> T L;
    let tupnil : Tuple nil                  = \T n c. n;
    let tupcons : {A As} -> A -> Tuple As -> Tuple (cons A As)
        = \a tas T n c. c a (tas T n c);
```
### LTree
```
    let LTree : {n} -> U -> U
        = \{n} A. (T : Nat -> U) -> (A -> T zero) -> ({m} -> T m -> T m -> T (suc m)) -> T n;
    let leaf : {A} -> A -> LTree {zero} A   = \a T l n. l a;
    let node : {A n} -> LTree {n} A -> LTree {n} A -> LTree {suc n} A
        = \ta tb T l n. n (ta T l n) (tb T l n);

    let initWord : {n} -> DNat {n} -> LTree {n} Bool
        = \dn. dn (\n. LTree {n} Bool) (\acc. node acc acc) (leaf O);
```
## Encoding record types
### Functor
```
    let Functor : (U -> U) -> U
        = \(F : U -> U). {T} -> ((map : {A B} -> (A -> B) -> F A -> F B) -> F T) -> F T;

    let listFunctor : Functor List
        = \F. F (\fn la L n c. la L n (\a as. c (fn a) as));
    let ltreeFunctor : Functor LTree
        = \F. F (\fn ta T l n. ta T (\a. l (fn a)) n);

    ltreeFunctor (\map. map not (initWord (ds (ds dz))))
```
### Applicative
```
    let App : (U -> U) -> U
        = \(F : U -> U). {T} -> ((pure : {A} -> A -> F A) ->
            (ap : {A B} -> F (A -> B) -> F A -> F B) -> F T) -> F T;

    let appFunctor : {F} -> App F -> Functor F
        = \app F. app (\pure ap. F (\{A}{B} fn fa. ap {A}{B} (pure fn) fa));
    let listApp : App List
        = \A. A (\x. cons x nil)
            (\fs xs. fs _ nil (\f bs. concat (listFunctor (\map. map f xs)) bs));
```
### Monad
```
    let Monad : (U -> U) -> U
        = \(F : U -> U). {T} -> ((return : {A} -> A -> F A) ->
            (bind : {A B} -> F A -> (A -> F B) -> F B) -> F T) -> F T;

    let monadApp : {F} -> Monad F -> App F
        = \monad A. monad (\return bind. A return (\fs xs. bind fs (\f. bind xs (\x. return (f x)))));
```
### Traversable
```
    let Trav : (U -> U) -> U
        = \F. (S : U -> U){T} ->
            ((traverse : {G : U -> U}{app : App G}{B A} -> (A -> G B) -> F A -> G (F B)) -> S (F T)) -> S (F T);

    let listTrav : Trav List
        = \_ T. T (\{G}{app}{B} f la. app {List B}
            (\pure ap. la (G (List B)) (pure nil) (\a as. ap (ap (pure cons) (f a)) as)));

    let mapM : {F}{trav : Trav F}{M}{monad : Monad M}{B A} -> (A -> M B) -> F A -> M (F B)
        = \{F}{trav}{M}{monad} f as. trav M (\traverse. traverse {app=monadApp monad} f as);
```
### Dependent Sum
```
    let Sigma : (A : U)(B : A -> U){a : A} -> U
        = \A B {a}. (S : A -> U) -> ((fst : A)(snd : B fst) -> S fst) -> S a;
    let dpair : {A}{B : A -> U}(a : A)(b : B a) -> Sigma A B {a}
        = \a b S s. s a b;
    let proj1 : {A}{B : A -> U}{a : A} -> Sigma A B {a} -> A
        = \{A} s. s (\_. A) (\fst snd. fst);
    let proj2 : {A}{B : A -> U}{a : A} -> Sigma A B {a} -> B a
        = \{B=B} s. s B (\fst snd. snd);
    let smap
        : {A B}{P : A -> U}{Q : B -> U}
            (f : A -> B) -> ({x} -> P x -> Q (f x)) -> Sigma A P -> Sigma B Q
        =\{B=B}{Q=Q} f g s. s (\b. Sigma B Q) (\x y. dpair (f x) (g y));
```
### Containers
```
    let Container : {Sh} -> U
        = \{Sh}. (C : U -> U) -> ((Shape : U)(Position : Shape -> U) -> C Shape) -> C Sh;
    let cpair : (Sh : U)(Pos : Sh -> U) -> Container {Sh}
        = \Sh Pos C c. c Sh Pos;
    let cshape : {Sh} -> Container {Sh} -> U
        = \c. c (\_. U) (\Sh Pos. Sh);
    let cposition : {Sh} -> Container {Sh} -> Sh -> U
        = \c. c (\Sh. Sh -> U) (\Sh Pos. Pos);
    let cextend : {Sh}{sh : Sh} -> Container {Sh} -> U -> U
        = \{Sh}{sh} C X. Sigma Sh (\s. (cposition {Sh} C) s -> X) {sh};

    proj2 (tt (cextend {Nat} (cpair Nat (\n. Fin {n})) Bit)
        (dpair (suc (suc zero)) (\fn. listLookup (cons I (cons O nil)) fn))) (fz)
```
## Reasoning
### Leibniz equality
```
    let Eq : {T} -> T -> T -> U             = \{T} x y. (P : T -> U) -> P x -> P y;
    let refl : {T t} -> Eq {T} t t          = \P pt. pt;
    let trans : {T}{x y z : T} -> Eq y z -> Eq x y -> Eq {T} x z
        = \yz xy P px. yz P (xy P px);
    let sym : {T}{x y : T} -> Eq x y -> Eq {T} y x
        = \{T}{x} xy P. xy (\z. P z -> P x) (refl {T} P);
    let cong : {A B x y}(f : A -> B) -> Eq x y -> Eq {B} (f x) (f y)
        = \f xy P. xy (\x. P (f x));
    let subst : {T}{x y : T}(P : T -> U) -> Eq x y -> P x -> P y
        = \P xy. xy P;

    let step : {A}(x : A){y : A} -> Eq x y -> Eq {A} x y
        = \_ xy. xy;
    let stepAs : {A}(x : A){y z : A} -> Eq x y -> Eq y z -> Eq {A} x z
        = \_ xy yz. trans yz xy;
    let qed : {A}(x : A) -> Eq {A} x x      = \_. refl;
```
### Proofs
```
    let addRightIden : {n : Nat}{dn : DNat {n}} -> Eq {Nat} (add n zero) n
        = \{n}{dn}. dn (\n. Eq {Nat} (add n zero) n) (cong suc) refl;

    let addAssoc
        : {m n p : Nat}{dm : DNat {m}} -> Eq {Nat} (add (add m n) p) (add m (add n p))
        = \ {m}{n}{p}{dm}. dm (\m. Eq {Nat} (add (add m n) p) (add m (add n p))) (cong suc) refl;

    let addSuc : (m n : Nat){dm : DNat {m}} -> Eq (add m (suc n)) (suc (add m n))
        = \m n {dm}. dm (\m. Eq (add m (suc n)) (suc (add m n))) (cong suc) refl;
    let addCommSuc
        : {k}(n : Nat){dn : DNat {n}} -> Eq (add n k) (add k n) ->
            Eq (add n (suc k)) (add (suc k) n)
        = \{k} n {dn} acc.
            stepAs (add n (suc k)) (addSuc n k {dn})
            (stepAs (suc (add n k)) (cong suc acc)
            (qed (add (suc k) n)));
    let addComm : {m n : Nat}{dm : DNat {m}}{dn : DNat {n}} -> Eq (add m n) (add n m)
        = \{m}{n}{dm}{dn}. dn (\n. Eq {Nat} (add m n) (add n m)) (addCommSuc m {dm}) (addRightIden {m}{dm});
```