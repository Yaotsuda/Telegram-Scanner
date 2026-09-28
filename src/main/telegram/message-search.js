const db=require('../database/database')
module.exports= {
  search:filters=>db.searchMessages(filters)
}
