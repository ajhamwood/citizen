if (parsing = true) {
  // With parsing

  console.log('Initial string:')
  let teststring = `
  # Pi Lambda
  (Bool : Type) (true, false : Bool)
  id2 := (s, y => y) : (t : Type), (z : t) ==> t
  id1 := (x => x) : (a : Bool) ==> Bool

  idB := id2 Bool
  idB true
  `;
  let lex;
  console.log(`\`${teststring}\``)
  console.log('\nLexer:');
  console.log(lex = L.tokenise(teststring));
  P.parse(lex).then(int => {
    console.log('\nParser:')
    console.log(int);
    console.log('\nPrinter:')
    int.forEach(decl => {
      if (decl.constructor === P.Assume) console.log(decl.string + ' : ' + PP.print(decl.type));
      else if (decl.constructor === P.Eval) console.log(decl.lhs + ' := ' + PP.print(decl.rhs))
    });
    console.log('\nInterpreter')
    let state = new I.State(new AST.Context(), new AST.NameEnvironment());
    return I.evaluate(teststring, state)
  }).then(console.log).catch(e => console.log(e));

} else {
// Without parsing

  let id = new AST.Lambda(new AST.Lambda(new AST.Inferred(new AST.Bound(0)))),
      tfree = x => new AST.Inferred(new AST.Free(new AST.Global(x))),
      term = new AST.Apply(new AST.Annotated(id, new AST.Inferred(new AST.Pi(new AST.Inferred(new AST.Star()), new AST.Inferred(new AST.Pi(new AST.Inferred(new AST.Bound(0)), new AST.Inferred(new AST.Bound(1))))))), tfree('a')),
      term1              = new AST.Annotated(id, new AST.Inferred(new AST.Pi(new AST.Inferred(new AST.Star()), new AST.Inferred(new AST.Pi(new AST.Inferred(new AST.Bound(0)), new AST.Inferred(new AST.Bound(1))))))),
      env = new AST.Context().cons(new AST.NameTypePair().setValue(new AST.Global('y'), new AST.Type(AST.vfree(new AST.Global('a')))))
        .cons(new AST.NameTypePair().setValue(new AST.Global('a'), new AST.Type(new AST.VStar())));


  console.log('Printer:');

  [ AST.initialQuote(AST.inferEvaluate(term, new AST.Environment(), new AST.NameEnvironment())),
    AST.initialInferType(env, new AST.NameEnvironment(), term)].forEach(expr => {
    if (U.testExtendedCtor(expr, AST.CheckableTerm)) {
      console.log(expr);
      console.log(PP.print(expr))
    } else if (U.testExtendedCtor(expr, AST.Result)) {
      if (U.testCtor(expr, expr.Right)) {
        console.log(AST.initialQuote(expr.value.value));
        console.log(PP.print(AST.initialQuote(expr.value.value)))
      } else if (U.testCtor(expr, expr.Left)) console.log('Evaluation error: ' + expr.value)
    }
  })

}
