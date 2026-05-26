package com.automationcenter.entity;

public enum AwsResources {

    AWS_LAMBDA("aws_lambda"),
    AWS_ECS("aws_ecs"),
    AWS_EC2("aws_ec2"),
    AWS_SSM("aws_ssm");

    private String service;

    AwsResources(String service) {
        this.service = service;
    }

    public String getService() {
        return service;
    }

    public void setService(String service) {
        this.service = service;
    }
}
