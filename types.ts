
/*
    We will hold the value, and based on the value, it will be assigned to a
    different variable(e.g: 2 -> x2; 1 -> x1). That will be the variable ID.

    A negative value means a negative literal, aka -2 -> !x2
*/
type Literal = {
    value: number;
}

/*
    A list of literals.
 */
type Clause = {
    value: Literal[];
}




// CNF: ^ intre ()

type CnfFormula = {
    value: Clause[];
}

/*
    The way we would assign values to literals.
 */
type Assign = Map<number, boolean>;

