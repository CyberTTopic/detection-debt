import {connector} from './connector'
import {logTable} from './logTable'
import {technique} from './technique'
import {detectionRule} from './detectionRule'
import {baselineControl} from './baselineControl'
import {tuningDecision} from './tuningDecision'

/**
 * Registration order follows the dependency chain, so the Studio's document list
 * reads the way the graph is traversed: connector -> logTable -> rule -> technique,
 * with baselineControl and tuningDecision as the two cross-cutting types.
 */
export const schemaTypes = [
  connector,
  logTable,
  detectionRule,
  technique,
  baselineControl,
  tuningDecision,
]
