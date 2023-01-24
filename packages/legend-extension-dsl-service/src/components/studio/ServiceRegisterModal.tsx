/**
 * Copyright (c) 2020-present, Goldman Sachs
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { useState } from 'react';
import { observer } from 'mobx-react-lite';
import {
  ActionState,
  assertErrorThrown,
  assertNonEmptyString,
  guaranteeNonNullable,
  LogEvent,
  uuid,
} from '@finos/legend-shared';
import {
  generateServiceManagementUrl,
  LATEST_PROJECT_REVISION,
  LEGEND_STUDIO_APP_EVENT,
} from '@finos/legend-application-studio';
import { createServiceElement } from '../../stores/studio/QueryProductionizerStore.js';
import {
  CheckSquareIcon,
  clsx,
  CustomSelectorInput,
  Dialog,
  Modal,
  ModalTitle,
  Panel,
  PanelFullContent,
  PanelLoadingIndicator,
  RocketIcon,
  SquareIcon,
} from '@finos/legend-art';
import {
  ActionAlertType,
  ActionAlertActionType,
} from '@finos/legend-application';
import {
  ServiceExecutionMode,
  isValidFullPath,
  validate_ServicePattern,
} from '@finos/legend-graph';
import type { ExistingQueryEditorStore } from '@finos/legend-application-query';
import { ProjectData } from '@finos/legend-server-depot';

const ServiceRegisterModal = observer(
  (props: { editorStore: ExistingQueryEditorStore; onClose(): void }) => {
    const { editorStore, onClose } = props;
    const [registrationState] = useState(ActionState.create());
    const [text, setText] = useState('');
    const [serviceEnv, setServiceEnv] = useState<string | undefined>(undefined);
    const [servicePath, setServicePath] = useState('model::QueryService');
    const [activateService, setActivateService] = useState(false);
    const [servicePattern, setServicePattern] = useState(`/${uuid()}`);
    const [owners, setOwners] = useState<string[]>([]);
    const [isServicePathValid, setIsValidServicePath] = useState(true);
    const [isServiceUrlPatternValid, setIsServiceUrlPatternValid] =
      useState(true);
    const onTextChange = (value: string): void => {
      if (value !== text) {
        setText(value);
      }
    };
    const onUserOptionChange = (options: string[]): void => {
      setOwners(options);
    };
    const onChangeServicePath: React.ChangeEventHandler<HTMLInputElement> = (
      event,
    ) => {
      setServicePath(event.target.value);
      setIsValidServicePath(isValidFullPath(event.target.value));
    };

    const onChangeServicePattern: React.ChangeEventHandler<HTMLInputElement> = (
      event,
    ) => {
      setServicePattern(event.target.value);
      setIsServiceUrlPatternValid(!validate_ServicePattern(event.target.value));
    };
    const serverRegistrationOptions =
      editorStore.applicationStore.config.options
        .TEMPORARY__serviceRegistrationConfig;

    const envOptions = serverRegistrationOptions
      .filter((options) =>
        options.modes.includes(ServiceExecutionMode.SEMI_INTERACTIVE),
      )
      .map((info) => ({
        label: info.env.toUpperCase(),
        value: info.env,
      }));
    const selectedEnvOption = serviceEnv
      ? {
          label: serviceEnv.toUpperCase(),
          value: serviceEnv,
        }
      : null;
    const onServerEnvChange = (
      val: { label: string; value: string } | null,
    ): void => {
      setServiceEnv(val?.value);
    };
    const toggleActivateService = (): void =>
      setActivateService(!activateService);

    const registerService = editorStore.applicationStore.guardUnhandledError(
      async (): Promise<void> => {
        const project = ProjectData.serialization.fromJson(
          await editorStore.depotServerClient.getProject(
            editorStore.query.groupId,
            editorStore.query.artifactId,
          ),
        );
        const currentQueryInfo =
          await editorStore.graphManagerState.graphManager.getQueryInfo(
            editorStore.query.id,
          );
        if (
          registrationState.isInProgress ||
          !servicePath ||
          !servicePattern ||
          !isServicePathValid ||
          !isServiceUrlPatternValid ||
          !selectedEnvOption
        ) {
          return;
        }
        try {
          registrationState.inProgress();
          const serverUrl = guaranteeNonNullable(
            serverRegistrationOptions.find(
              (option) => option.env === selectedEnvOption.value,
            )?.managementUrl,
          );
          const versionInput = LATEST_PROJECT_REVISION;
          registrationState.setMessage(`Registering service...`);
          const service = await createServiceElement(
            servicePath,
            servicePattern,
            owners,
            currentQueryInfo.content,
            currentQueryInfo.mapping,
            currentQueryInfo.runtime,
            editorStore.graphManagerState,
          );
          const serviceRegistrationResult =
            await editorStore.graphManagerState.graphManager.registerService(
              service,
              editorStore.graphManagerState.graph,
              project.groupId,
              project.artifactId,
              versionInput,
              serverUrl,
              ServiceExecutionMode.SEMI_INTERACTIVE,
            );
          if (activateService) {
            registrationState.setMessage(`Activating service...`);
            await editorStore.graphManagerState.graphManager.activateService(
              serverUrl,
              serviceRegistrationResult.serviceInstanceId,
            );
          }
          assertNonEmptyString(
            serviceRegistrationResult.pattern,
            'Service registration pattern is missing or empty',
          );

          editorStore.applicationStore.setActionAlertInfo({
            message: `Service with pattern ${
              serviceRegistrationResult.pattern
            } registered ${activateService ? 'and activated ' : ''}`,
            prompt:
              'You can now launch and monitor the operation of your service',
            type: ActionAlertType.STANDARD,
            actions: [
              {
                label: 'Launch Service',
                type: ActionAlertActionType.PROCEED,
                handler: (): void => {
                  editorStore.applicationStore.navigator.visitAddress(
                    generateServiceManagementUrl(
                      guaranteeNonNullable(serverUrl),
                      serviceRegistrationResult.pattern,
                    ),
                  );
                },
                default: true,
              },
              {
                label: 'Close',
                type: ActionAlertActionType.PROCEED_WITH_CAUTION,
              },
            ],
          });
        } catch (error) {
          assertErrorThrown(error);
          editorStore.applicationStore.log.error(
            LogEvent.create(
              LEGEND_STUDIO_APP_EVENT.SERVICE_REGISTRATION_FAILURE,
            ),
            error,
          );
          editorStore.applicationStore.notifyError(error);
        } finally {
          registrationState.reset();
          registrationState.setMessage(undefined);
        }
      },
    );

    return (
      <Dialog
        open={true}
        onClose={onClose}
        classes={{ container: 'search-modal__container' }}
        PaperProps={{ classes: { root: 'search-modal__inner-container' } }}
      >
        <Modal darkMode={true} className="search-modal">
          <ModalTitle title="Regiser Service Semi-interactively..." />
          <Panel>
            <PanelLoadingIndicator isLoading={registrationState.isInProgress} />
            <PanelFullContent>
              <div className="service-register-modal__group__content">
                <div className="service-register-modal__input">
                  <div className="service-register-modal__input__label">
                    Path
                  </div>
                  <div className="input-group service-register-modal__input__input">
                    <input
                      className={clsx('input input--dark input-group__input', {
                        'input-group__input--error': !isServicePathValid,
                      })}
                      spellCheck={false}
                      placeholder="Enter the full path for your service (e.g. model::MyQueryService)"
                      value={servicePath}
                      onChange={onChangeServicePath}
                    />
                    {!isServicePathValid && (
                      <div className="input-group__error-message">
                        Invalid full path
                      </div>
                    )}
                  </div>
                </div>
                <div className="service-register-modal__input">
                  <div className="service-register-modal__input__label">
                    URL
                  </div>
                  <div className="input-group service-register-modal__input__input">
                    <input
                      className={clsx('input input--dark input-group__input', {
                        'input-group__input--error': Boolean(
                          !isServiceUrlPatternValid,
                        ),
                      })}
                      spellCheck={false}
                      placeholder="/my-service-url"
                      value={servicePattern}
                      onChange={onChangeServicePattern}
                    />
                    {!isServiceUrlPatternValid && (
                      <div className="input-group__error-message">
                        URL pattern is not valid
                      </div>
                    )}
                  </div>
                </div>
                <div className="service-register-modal__input">
                  <div className="service-register-modal__input__label">
                    OWNERS
                  </div>
                  <div className="input-group service-register-modal__input__selector">
                    <CustomSelectorInput
                      className="service-register-modal___service-owner__selector"
                      placeholder={'Enter an owner...'}
                      spellCheck={false}
                      inputValue={text}
                      darkMode={true}
                      onInputChange={onTextChange}
                      onChange={onUserOptionChange}
                      isMulti={true}
                      allowCreating={true}
                      value={owners}
                    />
                  </div>
                </div>
                <div className="service-register-modal__input">
                  <div className="service-register-modal__input__label">
                    Execution Server
                  </div>
                  <div className="input-group service-register-modal__input__selector">
                    <CustomSelectorInput
                      options={envOptions}
                      onChange={onServerEnvChange}
                      value={selectedEnvOption}
                      darkMode={true}
                    />
                  </div>
                </div>
                <div
                  className="service-register-modal__auto-activation__toggler"
                  onClick={toggleActivateService}
                >
                  <div className="panel__content__form__section__toggler">
                    <button
                      className={clsx(
                        'panel__content__form__section__toggler__btn',
                        {
                          'panel__content__form__section__toggler__btn--toggled':
                            activateService,
                        },
                      )}
                      tabIndex={-1}
                    >
                      {activateService ? <CheckSquareIcon /> : <SquareIcon />}
                    </button>
                    <div className="panel__content__form__section__toggler__prompt">
                      Activate service after registration
                    </div>
                  </div>
                </div>
              </div>
            </PanelFullContent>
          </Panel>
          <div className="search-modal__actions">
            <button className="btn btn--dark" onClick={registerService}>
              Register Service
            </button>
            <button className="btn btn--dark" onClick={onClose}>
              Close
            </button>
          </div>
        </Modal>
      </Dialog>
    );
  },
);

export const ServiceRegisterAction = observer(
  (props: { editorStore: ExistingQueryEditorStore }) => {
    const { editorStore } = props;
    const [showRegisterServiceModal, setShowRegisterServiceModal] =
      useState(false);
    const registerCurrentQuery = (): void => {
      setShowRegisterServiceModal(true);
    };
    const onClose = (): void => setShowRegisterServiceModal(false);
    return (
      <>
        <button
          className="query-editor__header__action btn--dark"
          tabIndex={-1}
          onClick={registerCurrentQuery}
          title="Register query as service..."
        >
          <RocketIcon />
        </button>
        {showRegisterServiceModal && (
          <ServiceRegisterModal editorStore={editorStore} onClose={onClose} />
        )}
      </>
    );
  },
);