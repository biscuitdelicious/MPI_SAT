
/*
    We will hold the value, and based on the value, it will be assigned to a
    different variable(e.g: 2 -> x2; 1 -> x1). That will be the variable ID.

    A negative value means a negative literal, aka -2 -> !x2
*/

export type Literal = number;

/*
    A set of literals. We uset set over list for performance:
    you can't have 2 literals in the same list or even opposite
    and Set comes with has() function which is very efficient for searching.
 */

export type Clause = Set<Literal>;

// CNF: ^ intre ()

export type CnfFormula = Clause[];

/*
    The way we would assign values to literals.
    We will use a map due to its performance for adding and removing
    elements from it.
 */


type Assign = Map<number, boolean>;

