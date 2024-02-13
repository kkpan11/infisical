import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import Head from "next/head";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/router";
import {
  faAngleDown,
  faArrowUpRightFromSquare,
  faBookOpen,
  faBugs,
  faCheckCircle,
  faCircleInfo
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { yupResolver } from "@hookform/resolvers/yup";
import axios from "axios";
import { motion } from "framer-motion";
import queryString from "query-string";
import * as yup from "yup";

import { useNotificationContext } from "@app/components/context/Notifications/NotificationProvider";
import {
  Button,
  Card,
  CardTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  FormControl,
  Input,
  Select,
  SelectItem,
  Tab,
  TabList,
  TabPanel,
  Tabs
} from "@app/components/v2";
import {
  useCreateIntegration,
  useGetIntegrationAuthApps,
  useGetIntegrationAuthById,
  useGetIntegrationAuthGithubOrgs,
  useGetWorkspaceById
} from "@app/hooks/api";

enum TabSections {
  Connection = "connection",
  Options = "options"
}

const targetEnv = [
  "github-repo",
  "github-org",
  "github-env"
] as const;
type TargetEnv = typeof targetEnv[number];


const schema = yup.object({
  selectedSourceEnvironment: yup.string().trim().required("Project Environment is required"),
  secretPath: yup.string().trim().required("Secrets Path is required"),
  secretSuffix: yup.string().trim().optional(),

  scope: yup.mixed<TargetEnv>().oneOf(targetEnv.slice()).required(),
  repoIds: yup
    .array(yup.string().required())
    .min(1, "Select atleast one repo") // .min() not working showing error for empty array
    .optional(),
  repoId: yup
    .string()
    .optional(),
  
  envId: yup
    .string()
    .optional(),
  
  orgId: yup
    .string()
    .optional(),
  
});

type FormData = yup.InferType<typeof schema>;

export default function GitHubCreateIntegrationPage() {
  const router = useRouter();
  const { mutateAsync } = useCreateIntegration();
  const { createNotification } = useNotificationContext();

  const { integrationAuthId } = queryString.parse(router.asPath.split("?")[1]);

  const { data: workspace } = useGetWorkspaceById(localStorage.getItem("projectData.id") ?? "");
  const { data: integrationAuth } = useGetIntegrationAuthById((integrationAuthId as string) ?? "");
  const { data: integrationAuthApps, isLoading: isIntegrationAuthAppsLoading } =
    useGetIntegrationAuthApps({
      integrationAuthId: (integrationAuthId as string) ?? ""
    });
  
  const { data: integrationAuthOrgs } =
    useGetIntegrationAuthGithubOrgs(integrationAuthId as string);

  const { control, handleSubmit, watch, setValue } = useForm<FormData>({
    resolver: yupResolver(schema),
    defaultValues: {
      selectedSourceEnvironment: "",
      secretPath: "/",
      repoIds: [],
      secretSuffix: "",
      scope: "github-repo"
    }
  });

  const scope = watch("scope");

  const repoIds = watch("repoIds");
  
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (workspace) {
      setValue("selectedSourceEnvironment", workspace.environments[0].slug);
    }
  }, [workspace]);

  useEffect(() => {
    if (integrationAuthApps) {
      if (integrationAuthApps.length > 0) {
        setValue("repoIds", [String(integrationAuthApps[0].appId)]);
      } else {
        setValue("repoIds", ["none"]);
      }
    }
  }, [integrationAuthApps]);

  const onFormSubmit = async (data: FormData) => {
    try {
      setIsLoading(true);

      if (!integrationAuth?.id) return;

      const targetApps = integrationAuthApps?.filter((integrationAuthApp) =>
        data.repoIds?.includes(String(integrationAuthApp.appId))
      );

      if (!targetApps) return;

      await Promise.all(
        targetApps.map(async (targetApp) => {
          await mutateAsync({
            integrationAuthId: integrationAuth?.id,
            isActive: true,
            app: targetApp.name,
            owner: targetApp.owner,
            secretPath: data.secretPath,
            sourceEnvironment: data.selectedSourceEnvironment,
            metadata: {
              secretSuffix: data.secretSuffix
            }
          });
        })
      );

      setIsLoading(false);
      router.push(`/integrations/${localStorage.getItem("projectData.id")}`);
    } catch (err) {
      console.error(err);
      if (axios.isAxiosError(err)) {
        const { message } = err?.response?.data as { message: string };
        createNotification({
          text: message,
          type: "error"
        });
      }
      setIsLoading(false);
    }
  };

  return integrationAuth && workspace && integrationAuthApps ? (
    <div className="flex h-full w-full flex-col items-center justify-center">
      <Head>
        <title>Set Up GitHub Integration</title>
        <link rel="icon" href="/infisical.ico" />
      </Head>
      <Card className="max-w-lg rounded-md border border-mineshaft-600 p-0">
        <form onSubmit={handleSubmit(onFormSubmit)} className="px-6">
          <CardTitle
            className="px-0 text-left text-xl"
            subTitle="Choose which environment in Infisical you want to sync to environment variables in GitHub."
          >
            <div className="flex flex-row items-center">
              <div className="flex items-center rounded-full bg-mineshaft-200">
                <Image
                  src="/images/integrations/GitHub.png"
                  height={30}
                  width={30}
                  alt="GitHub logo"
                />
              </div>
              <span className="ml-2.5">GitHub Integration </span>
              <Link href="https://infisical.com/docs/integrations/cicd/githubactions" passHref>
                <a target="_blank" rel="noopener noreferrer">
                  <div className="ml-2 mb-1 inline-block cursor-default rounded-md bg-yellow/20 px-1.5 pb-[0.03rem] pt-[0.04rem] text-sm text-yellow opacity-80 hover:opacity-100">
                    <FontAwesomeIcon icon={faBookOpen} className="mr-1.5" />
                    Docs
                    <FontAwesomeIcon
                      icon={faArrowUpRightFromSquare}
                      className="ml-1.5 mb-[0.07rem] text-xxs"
                    />
                  </div>
                </a>
              </Link>
            </div>
          </CardTitle>
          <Tabs defaultValue={TabSections.Connection}>
            <TabList>
              <div className="flex w-full flex-row border-b border-mineshaft-600">
                <Tab value={TabSections.Connection}>Connection</Tab>
                <Tab value={TabSections.Options}>Options</Tab>
              </div>
            </TabList>
            <TabPanel value={TabSections.Connection}>
              <motion.div
                key="panel-1"
                transition={{ duration: 0.15 }}
                initial={{ opacity: 0, translateX: 30 }}
                animate={{ opacity: 1, translateX: 0 }}
                exit={{ opacity: 0, translateX: 30 }}
              >
                <Controller
                  control={control}
                  name="selectedSourceEnvironment"
                  render={({ field: { onChange, ...field }, fieldState: { error } }) => (
                    <FormControl
                      label="Project Environment"
                      errorText={error?.message}
                      isError={Boolean(error)}
                    >
                      <Select
                        defaultValue={field.value}
                        onValueChange={(e) => onChange(e)}
                        className="w-full border border-mineshaft-500"
                      >
                        {workspace?.environments.map((sourceEnvironment) => (
                          <SelectItem
                            value={sourceEnvironment.slug}
                            key={`source-environment-${sourceEnvironment.slug}`}
                          >
                            {sourceEnvironment.name}
                          </SelectItem>
                        ))}
                      </Select>
                    </FormControl>
                  )}
                />
                <Controller
                  control={control}
                  name="secretPath"
                  render={({ field, fieldState: { error } }) => (
                    <FormControl
                      label="Secrets Path"
                      errorText={error?.message}
                      isError={Boolean(error)}
                    >
                      <Input {...field} placeholder="Provide a path, default is /" />
                    </FormControl>
                  )}
                />

                <Controller
                  control={control}
                  name="scope"
                  render={({ field: { onChange, ...field }, fieldState: { error } }) => (
                    <FormControl
                      label="Scope"
                      errorText={error?.message}
                      isError={Boolean(error)}
                    >
                      <Select
                        defaultValue={field.value}
                        onValueChange={(e) => onChange(e)}
                        className="w-full border border-mineshaft-500"
                      >
                        <SelectItem value="github-repo">Github Repositories</SelectItem>
                        <SelectItem value="github-org">Github Organization</SelectItem>
                        <SelectItem value="github-env">Github Environment</SelectItem>
                      </Select>
                    </FormControl>
                  )}
                />

                {scope === "github-repo" && repoIds && (
                  <Controller
                    control={control}
                    name="repoIds"
                    render={({ field: { onChange }}) => (
                      <FormControl
                        label="GitHub Repo"
                        // BUG: yup.min() not working as expected needs to be fixed
                        errorText="Atleast one repo is required"
                        isError={repoIds?.length === 0}
                      >
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            {integrationAuthApps.length > 0 ? (
                              <div className="inline-flex w-full cursor-pointer items-center justify-between rounded-md border border-mineshaft-600 bg-mineshaft-900 px-3 py-2 font-inter text-sm font-normal text-bunker-200 outline-none data-[placeholder]:text-mineshaft-200">
                                {repoIds.length === 1
                                  ? integrationAuthApps?.find(
                                      (integrationAuthApp) =>
                                        repoIds[0] === String(integrationAuthApp.appId)
                                    )?.name
                                  : `${repoIds.length} repositories selected`}
                                <FontAwesomeIcon icon={faAngleDown} className="text-xs" />
                              </div>
                            ) : (
                              <div className="inline-flex w-full cursor-default items-center justify-between rounded-md border border-mineshaft-600 bg-mineshaft-900 px-3 py-2 font-inter text-sm font-normal text-bunker-200 outline-none data-[placeholder]:text-mineshaft-200">
                                No repositories found
                              </div>
                            )}
                          </DropdownMenuTrigger>
                          <DropdownMenuContent
                            align="start"
                            className="thin-scrollbar z-[100] max-h-80 overflow-y-scroll"
                          >
                            {integrationAuthApps.length > 0 ? (
                              integrationAuthApps.map((integrationAuthApp) => {
                                const isSelected = repoIds.includes(
                                  String(integrationAuthApp.appId)
                                );

                                return (
                                  <DropdownMenuItem
                                    onClick={() => {
                                      if (repoIds.includes(String(integrationAuthApp.appId))) {
                                        onChange(
                                          repoIds.filter(
                                            (appId) => appId !== String(integrationAuthApp.appId)
                                          )
                                        );
                                      } else {
                                        onChange([...repoIds, String(integrationAuthApp.appId)]);
                                      }
                                    }}
                                    key={`repos-id-${integrationAuthApp.appId}`}
                                    icon={
                                      isSelected ? (
                                        <FontAwesomeIcon
                                          icon={faCheckCircle}
                                          className="pr-0.5 text-primary"
                                        />
                                      ) : (
                                        <div className="pl-[1.01rem]" />
                                      )
                                    }
                                    iconPos="left"
                                    className="w-[28.4rem] text-sm"
                                  >
                                    {integrationAuthApp.name}
                                  </DropdownMenuItem>
                                );
                              })
                            ) : (
                              <div />
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </FormControl>
                    )}
                  />

                )}
                {scope === "github-org" && (
                  <Controller
                  control={control}
                  name="orgId"
                  render={({ field: { onChange, ...field }, fieldState: { error } }) => (
                    <FormControl
                      label="Organization"
                      errorText={error?.message}
                      isError={Boolean(error)}
                    >
                      <Select
                        defaultValue={field.value}
                        onValueChange={(e) => onChange(e)}
                        className="w-full border border-mineshaft-500"
                      >
                        {integrationAuthOrgs && integrationAuthOrgs.map(({name, orgId}) => (
                          <SelectItem
                            key={`github-organization-${orgId}`}
                            value={orgId}
                          >
                            {name}
                          </SelectItem>

                        ))}
                      </Select>
                    </FormControl>
                  )}
                />
                )}
                {scope === "github-env" && (
                  <Controller
                    control={control}
                    name="repoId"
                    render={({ field: { onChange, ...field }, fieldState: { error } }) => (
                      <FormControl
                        label="Repositories"
                        errorText={error?.message}
                        isError={Boolean(error)}
                      >
                        <Select
                          defaultValue={field.value}
                          onValueChange={(e) => onChange(e)}
                          className="w-full border border-mineshaft-500"
                        >
                          {integrationAuthApps.length > 0 ? (
                              integrationAuthApps.map((integrationAuthApp) => {
                                return (
                                  <SelectItem
                                    value={integrationAuthApp.appId as string}
                                    key={`repos-id-${integrationAuthApp.appId}`}
                                    className="w-[28.4rem] text-sm"
                                  >
                                    {integrationAuthApp.name}
                                  </SelectItem>
                                );
                              })
                            ) : (
                              <div />
                          )
                  }
                        </Select>
                      </FormControl>
                    )}
                  />
                )}
                {scope === "github-env" && (
                  <Controller
                    control={control}
                    name="envId"
                    render={({ field: { onChange, ...field }, fieldState: { error } }) => (
                      <FormControl
                        label="Environment"
                        errorText={error?.message}
                        isError={Boolean(error)}
                      >
                        <Select
                          defaultValue={field.value}
                          onValueChange={(e) => onChange(e)}
                          className="w-full border border-mineshaft-500"
                        >
                          <SelectItem value="github-repo">Select Environment</SelectItem>
                        </Select>
                      </FormControl>
                    )}
                  />
                )}
              </motion.div>
            </TabPanel>
            <TabPanel value={TabSections.Options}>
              <motion.div
                key="panel-1"
                transition={{ duration: 0.15 }}
                initial={{ opacity: 0, translateX: -30 }}
                animate={{ opacity: 1, translateX: 0 }}
                exit={{ opacity: 0, translateX: 30 }}
              >
                <Controller
                  control={control}
                  name="secretSuffix"
                  render={({ field, fieldState: { error } }) => (
                    <FormControl
                      label="Append Secret Names with..."
                      className="pb-[9.75rem]"
                      errorText={error?.message}
                      isError={Boolean(error)}
                    >
                      <Input
                        {...field}
                        placeholder="Provide a suffix for secret names, default is no suffix"
                      />
                    </FormControl>
                  )}
                />
              </motion.div>
            </TabPanel>
          </Tabs>
          <div className="flex w-full justify-end">
            <Button
              type="submit"
              color="mineshaft"
              variant="outline_bg"
              className="mb-6"
              isLoading={isLoading}
              isDisabled={integrationAuthApps.length === 0 || repoIds?.length === 0}
            >
              Create Integration
            </Button>
          </div>
        </form>
      </Card>
      <div className="mt-6 w-full max-w-md border-t border-mineshaft-800" />
      <div className="mt-6 flex w-full max-w-lg flex-col rounded-md border border-mineshaft-600 bg-mineshaft-800 p-4">
        <div className="flex flex-row items-center">
          <FontAwesomeIcon icon={faCircleInfo} className="text-xl text-mineshaft-200" />{" "}
          <span className="text-md ml-3 text-mineshaft-100">Pro Tips</span>
        </div>
        <span className="mt-4 text-sm text-mineshaft-300">
          After creating an integration, your secrets will start syncing immediately. This might
          cause an unexpected override of current secrets in GitHub with secrets from Infisical.
        </span>
      </div>
    </div>
  ) : (
    <div className="flex h-full w-full items-center justify-center">
      <Head>
        <title>Set Up GitHub Integration</title>
        <link rel="icon" href="/infisical.ico" />
      </Head>
      {isIntegrationAuthAppsLoading ? (
        <img
          src="/images/loading/loading.gif"
          height={70}
          width={120}
          alt="infisical loading indicator"
        />
      ) : (
        <div className="flex h-max max-w-md flex-col rounded-md border border-mineshaft-600 bg-mineshaft-800 p-6 text-center text-mineshaft-200">
          <FontAwesomeIcon icon={faBugs} className="inlineli my-2 text-6xl" />
          <p>
            Something went wrong. Please contact{" "}
            <a
              className="inline cursor-pointer text-mineshaft-100 underline decoration-primary-500 underline-offset-4 opacity-80 duration-200 hover:opacity-100"
              target="_blank"
              rel="noopener noreferrer"
              href="mailto:support@infisical.com"
            >
              support@infisical.com
            </a>{" "}
            if the issue persists.
          </p>
        </div>
      )}
    </div>
  );
}

GitHubCreateIntegrationPage.requireAuth = true;
