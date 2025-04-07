const { dispatch, Router } = require('../components/spec/hyperdispatch')
const ActionValidator = require('./action-validator')

function createDispatch(type, action) {
  // Convert custom action type to hyperdispatch route
  const routeName = ActionValidator.ACTION_TYPE_MAP[type] || type

  return dispatch(routeName, {
    signature: action.signature,
    payload: action.payload
  })
}

module.exports = {
  dispatch: createDispatch,
  Router
}
