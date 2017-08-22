const Config = require('config');
const moment = require('moment');
const Log4js = require('log4js');
const R = require('ramda');
const ValidUrl = require('valid-url');

const Rest = require('../../restler-as-promise');
const localConstants = require('../../constants');
const helperClasses = require('../../helperClasses');
const utils = require('../../utils');

Log4js.configure('config/log4js_config.json', {});
const logger = Log4js.getLogger();
logger.level = Config.get('log-level');

const type = 'TRELLO'

function loadRawData (demandInfo, processingInfo, sinceTime, errorBody, constants) {
  logger.info(`loadStoryEntries(${type}) for ${demandInfo.project} updated since [${sinceTime}]`);
  return module.exports.loadDemand(demandInfo, sinceTime, errorBody, constants)
  .then(stories => {
    logger.debug(`total stories read - ${stories.length}`);
    if (stories.length < 1) {
      return [];
    }
    return processingInfo.storageFunction(processingInfo.dbUrl, processingInfo.rawLocation, stories)
  });
}

function loadDemand (demandInfo, sinceTime, errorBody, constants) {
  const mergedConstants = R.merge(localConstants, constants);
  const sinceMoment = moment(sinceTime, mergedConstants.dbDateformat);
  logger.info(`loadDemand() for ${type} project ${demandInfo.project}`);

  return Rest.get(appendAuth(`${demandInfo.url}/cards?fields=id,labels,dateLastActivity,shortUrl&actions=updateCard,createCard`, demandInfo))
  .then(({ data }) => {
    logger.info(`Success reading demand: count [${data.length}]`);
    const returner = data
    .filter(card => card.actions.length > 0)
    .filter(card => sinceMoment.isSameOrBefore(moment(card.dateLastActivity)))
    .map(card => R.merge(card, { creationDate: getCardCreationDate(card.id), _id: card.id }))

    return returner;
  })
  .catch((error) => {
    utils.logHttpError(logger, error)
    if (error.response && error.response.statusCode) {
      return Promise.reject(errorBody(error.response.statusCode, 'Error retrieving stories from Jira'));
    }
    return Promise.reject(error);
  });
}

function transformRawToCommon(issueData) {

  logger.info('mapTrelloDemand into a common format');

  const commonDataFormat = [];

  issueData.forEach(aStory => {
    const commonDemandEntry = new helperClasses.CommonDemandEntry(aStory.id);
    commonDemandEntry.uri = aStory.shortUrl;
    let historyEntry;
    const actions = aStory.actions.reverse().filter(action => action.data.listBefore);
    if (actions.length === 0) {
      historyEntry = new helperClasses.DemandHistoryEntry(aStory.actions[0].data.list.name, aStory.creationDate);
    } else {
      actions.forEach(action => {
        if (!historyEntry) {
          historyEntry = new helperClasses.DemandHistoryEntry(action.data.listBefore.name, aStory.creationDate);
        }
        historyEntry.changeDate = action.date;
        commonDemandEntry.history.push(historyEntry);
        historyEntry = new helperClasses.DemandHistoryEntry(action.data.listAfter.name, action.date);
      });
    }
    commonDemandEntry.history.push(historyEntry);
    commonDataFormat.push(commonDemandEntry);
  });

  return commonDataFormat;
}

function testDemand(project, constants) {
  const mergedConstants = R.merge(localConstants, constants);
  logger.info(`testDemand() for JIRA Project ${project.name}`);  

  if (!ValidUrl.isUri(project.demand.url)) {
    return Promise.resolve({ status: mergedConstants.STATUSERROR, data: utils.validationResponseMessageFormat(`invalid demand URL [${project.demand.url}]`) });
  }

  if (R.isNil(project.demand.project) || R.isEmpty(project.demand.project)) {
    return Promise.resolve({ status: mergedConstants.STATUSERROR, data: utils.validationResponseMessageFormat(`[Project] must be a valid Jira project name`) });
  }

  if (R.isNil(project.demand.authPolicy) || R.isEmpty(project.demand.authPolicy)) {
    return Promise.resolve({ status: mergedConstants.STATUSERROR, data: utils.validationResponseMessageFormat(`[Auth Policy] must be filled out`) });
  }

  if (R.isNil(project.demand.userData) || R.isEmpty(project.demand.userData)) {
    return Promise.resolve({ status: mergedConstants.STATUSERROR, data: utils.validationResponseMessageFormat(`[User Data] must be filled out`) });
  }

  if (R.isNil(project.demand.flow) || R.isEmpty(project.demand.flow)) {
    return Promise.resolve({ status: mergedConstants.STATUSERROR, data: utils.validationResponseMessageFormat(`Missing [Flow] information`) });
  }

  return Rest.get(appendAuth(`${project.demand.url}/cards?fields=id&limit=1`, project.demand))
  .then(() => ({ status: mergedConstants.STATUSOK }))
  .catch((error) => {
    utils.logHttpError(logger, error);
    return ({ status: mergedConstants.STATUSERROR, data: error.data });
  });
}

function appendAuth(url, demandInfo) {
  const keys = demandInfo.authPolicy.split(':');
  const values = demandInfo.userData.split(':');
  const divider = url.includes('?') ? '&' : '?';
  return `${url}${divider}${keys[0]}=${values[0]}&${keys[1]}=${values[1]}`;
}

function getCardCreationDate(cardId) {
  return moment.unix(parseInt(cardId.substring(0,8),16)).toISOString();
}

module.exports = {
  loadRawData,
  loadDemand,
  transformRawToCommon,
  testDemand,
}